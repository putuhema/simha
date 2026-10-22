/**
 * Finds tables and columns for a keyword, so the AI writes SQL against our
 * real (modified) schema instead of guessing. Three sources:
 * 1. docs/schema.md: documented tables with purpose, columns and relations;
 * 2. docs/khanza_notes.md: matching lines written by IT;
 * 3. the live database (information_schema): tables and columns whose name
 *    matches, which covers the many tables docs/schema.md does not list.
 * Protected columns are marked so the AI knows not to select them; credential
 * tables (user, admin, ...) are left out.
 */
import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { defineTool } from "../tool.ts";
import { SchemaDocs, type DocTable } from "./SchemaDocs.ts";
import { CREDENTIAL_TABLE_PATTERN, protectedColumn } from "./sensitive.ts";

const MAX_DOC_TABLES = 5;
const MAX_LIVE_TABLES = 5;
const MAX_NOTES = 20;
const MAX_COLUMN_MATCHES = 30;

/** Search words: lower case, at least 3 characters, letters/digits/underscore only. */
const searchWords = (keyword: string): ReadonlyArray<string> => [
  ...new Set(
    keyword
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length >= 3),
  ),
];

const describeColumn = (name: string, type: string, key = "", comment = "") => {
  const flags = [key === "PRI" ? "PK" : "", protectedColumn(name) ? "pribadi: jangan ditampilkan" : ""].filter(Boolean);
  return `${name} ${type}${flags.length ? ` [${flags.join(", ")}]` : ""}${comment ? ` — ${comment}` : ""}`;
};

const scoreTable = (doc: DocTable, words: ReadonlyArray<string>) =>
  words.reduce((score, w) => {
    if (doc.table.toLowerCase().includes(w)) return score + 3;
    const text = `${doc.purpose} ${doc.columns.map((c) => `${c.name} ${c.comment}`).join(" ")}`.toLowerCase();
    return text.includes(w) ? score + 1 : score;
  }, 0);

const likePattern = (word: string) => `%${word.replaceAll("_", "\\_")}%`;

export const lihatSkema = defineTool({
  name: "lihatSkema",
  kind: "read",
  description:
    "Look up tables and columns for a topic before writing SQL, e.g. 'obat', 'tindakan poli', 'kamar inap', " +
    "'penjab bpjs'. Returns documented tables (purpose, columns, relations), matching hospital notes, and " +
    "tables/columns from the live database whose names match. Use only names that appear here. Columns " +
    "marked 'pribadi' may only be used in WHERE/JOIN/GROUP BY or COUNT(). Call it again with other words if " +
    "you did not find what you need.",
  parameters: Schema.Struct({
    kataKunci: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100)).annotate({
      description: "One or more words: a topic, a table name or a column name.",
    }),
  }),
  output: Schema.Struct({
    dariDokumen: Schema.Array(
      Schema.Struct({
        tabel: Schema.String,
        keterangan: Schema.String,
        kolom: Schema.Array(Schema.String),
        relasi: Schema.Array(Schema.String),
      }),
    ),
    catatan: Schema.Array(Schema.String),
    dariDatabase: Schema.Array(Schema.Struct({ tabel: Schema.String, kolom: Schema.Array(Schema.String) })),
    tabelLain: Schema.Array(Schema.String),
    kolomCocok: Schema.Array(Schema.String),
    petunjuk: Schema.String,
  }),
  handler: Effect.fn("lihatSkema")(function* ({ kataKunci }) {
    const docs = yield* SchemaDocs;
    const read = yield* KhanzaRead;
    const words = searchWords(kataKunci);

    const documented = docs.tables
      .map((doc) => ({ doc, score: scoreTable(doc, words) }))
      .filter((d) => d.score > 0)
      .toSorted((a, b) => b.score - a.score)
      .slice(0, MAX_DOC_TABLES)
      .map(({ doc }) => ({
        tabel: doc.table,
        keterangan: doc.purpose,
        kolom: doc.columns.map((c) => describeColumn(c.name, c.type, c.key, c.comment)),
        relasi: doc.foreignKeys,
      }));

    const catatan = docs.notes.filter((line) => words.some((w) => line.toLowerCase().includes(w))).slice(0, MAX_NOTES);

    let dariDatabase: Array<{ tabel: string; kolom: Array<string> }> = [];
    let tabelLain: Array<string> = [];
    let kolomCocok: Array<string> = [];
    if (words.length > 0) {
      const patterns = words.map(likePattern);
      // Tables whose name matches, most specific (shortest) first.
      const tables = yield* read.query<{ t: string }>(
        (sql) => sql`
          SELECT TABLE_NAME AS t FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND (${sql.or(patterns.map((p) => sql`TABLE_NAME LIKE ${p}`))})
            AND LOWER(TABLE_NAME) NOT REGEXP ${CREDENTIAL_TABLE_PATTERN}
          ORDER BY CHAR_LENGTH(TABLE_NAME), TABLE_NAME LIMIT 40`,
      );
      const documentedNames = new Set(docs.tables.map((d) => d.table.toLowerCase()));
      const undocumented = tables.map((r) => r.t).filter((t) => !documentedNames.has(t.toLowerCase()));
      const detailed = undocumented.slice(0, MAX_LIVE_TABLES);
      tabelLain = undocumented.slice(MAX_LIVE_TABLES);

      if (detailed.length > 0) {
        const columns = yield* read.query<{ t: string; c: string; type: string; k: string }>(
          (sql) => sql`
            SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type, COLUMN_KEY AS k FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ${sql.in(detailed)}
            ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        );
        dariDatabase = detailed.map((tabel) => ({
          tabel,
          kolom: columns.filter((c) => c.t === tabel).slice(0, 80).map((c) => describeColumn(c.c, c.type, c.k)),
        }));
      }

      // Columns whose name matches, in any table (e.g. "kd_poli" finds every table that has it).
      // Whole-word matches ("obat", "kd_obat") rank above substrings ("pengobatan").
      const matches = yield* read.query<{ t: string; c: string }>(
        (sql) => sql`
          SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND (${sql.or(patterns.map((p) => sql`COLUMN_NAME LIKE ${p}`))})
            AND LOWER(TABLE_NAME) NOT REGEXP ${CREDENTIAL_TABLE_PATTERN}
          ORDER BY CHAR_LENGTH(TABLE_NAME), TABLE_NAME LIMIT 500`,
      );
      const rank = (column: string) => {
        const c = column.toLowerCase();
        if (words.includes(c)) return 0;
        return words.some((w) => new RegExp(`(^|_)${w}(_|$)`).test(c)) ? 1 : 2;
      };
      kolomCocok = matches
        .map((m, i) => ({ ...m, i, rank: rank(m.c) }))
        .toSorted((a, b) => a.rank - b.rank || a.i - b.i)
        .slice(0, MAX_COLUMN_MATCHES)
        .map((m) => `${m.t}.${m.c}`);
    }

    const found = documented.length + dariDatabase.length + kolomCocok.length > 0;
    return {
      dariDokumen: documented,
      catatan,
      dariDatabase,
      tabelLain,
      kolomCocok,
      petunjuk: found
        ? "Pakai hanya tabel dan kolom yang tercantum di sini. Kolom bertanda 'pribadi' tidak boleh ditampilkan."
        : `Tidak ada tabel atau kolom yang cocok dengan "${kataKunci}". Coba kata lain (nama tabel Khanza, mis. 'reg_periksa', 'obat', 'kamar').`,
    };
  }),
});

/**
 * Runs a SELECT the AI wrote, after select-guard.ts accepts it, on the
 * SELECT-only user with the query time limit. The result is stored so
 * `tampilkan` can show it; the model sees the first 50 rows.
 */
import { Effect, Schema } from "effect";
import { KhanzaQueryError, ToolError } from "../errors.ts";
import { CurrentSession, CurrentToolCall } from "../khanza/current-tool-call.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { defineTool } from "../tool.ts";
import { ResultStore, type Row } from "./ResultStore.ts";
import { checkSelect, MAX_QUERY_ROWS, QueryRejected, referencedTables } from "./select-guard.ts";

const NAME = "jalankanQueryBaca";

/** Failed attempts in a row (rejected or SQL error) before the tool stops accepting queries in a run. */
export const MAX_QUERY_FAILURES = 3;

/** Rows the AI model sees; the UI gets all of them through `tampilkan`. */
const ROWS_FOR_MODEL = 50;

/** JSON-safe cell values: binary columns are not sent anywhere. */
const cleanValue = (value: unknown): unknown => {
  if (value instanceof Uint8Array) return `[data biner ${value.length} byte]`;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
};

const cleanRow = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cleanValue(v)]));

const guard = (check: () => unknown) =>
  Effect.try({
    try: check,
    catch: (error) =>
      new ToolError({ tool: NAME, message: error instanceof QueryRejected ? `Query ditolak: ${error.message}` : String(error) }),
  });

/** Edit distance, bounded at 2: only used to suggest a column when the query names one that does not exist. */
const near = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 2) return false;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let previous = rows[0] ?? 0;
    rows[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const current = rows[i] ?? 0;
      rows[i] = Math.min(current + 1, (rows[i - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return (rows[a.length] ?? 99) <= 2;
};

/** Real columns that look like the misspelt one, so one failed query teaches the right name. */
const similarColumns = (name: string, columns: ReadonlyMap<string, ReadonlyArray<string>>): ReadonlyArray<string> => {
  const wanted = name.toLowerCase();
  const stem = wanted.slice(0, Math.max(3, Math.ceil(wanted.length / 2)));
  const found: Array<string> = [];
  for (const names of columns.values()) {
    for (const column of names) {
      if (found.includes(column) || !(column.startsWith(stem) || near(column, wanted))) continue;
      found.push(column);
      if (found.length >= 6) return found;
    }
  }
  return found;
};

/**
 * The driver's message plus the column names it probably meant. Without this
 * the model retries with another guess, which costs a whole turn.
 */
export const withHint = (error: KhanzaQueryError, columns: ReadonlyMap<string, ReadonlyArray<string>>): KhanzaQueryError => {
  if (error.kind !== "syntax") return error;
  const unknown = /Unknown column '([^']+)'/.exec(error.message)?.[1];
  if (unknown === undefined) return error;
  const name = unknown.slice(unknown.lastIndexOf(".") + 1);
  const similar = similarColumns(name, columns);
  const hint =
    similar.length === 0
      ? `Petunjuk: kolom "${name}" tidak ada di skema Khanza ini. Cek lagi dengan lihatSkema; jangan menebak.`
      : `Petunjuk: kolom "${name}" tidak ada. Kolom yang mirip: ${similar.join(", ")}.`;
  return new KhanzaQueryError({ kind: error.kind, message: `${error.message}\n${hint}` });
};

export const jalankanQueryBaca = defineTool({
  name: NAME,
  kind: "read",
  description:
    "Run ONE read-only SELECT you wrote (MariaDB/MySQL syntax) to answer a data question. Check table and " +
    "column names with lihatSkema first; never guess them. Rules: a single SELECT (WITH and UNION are fine), " +
    "only tables of the Khanza database, no comments, no @variables. Personal columns (no_ktp, no_tlp, alamat, " +
    "email, no_peserta, ...) may be used in WHERE/JOIN/GROUP BY or inside COUNT(), never returned; do not use " +
    `SELECT * on tables like pasien. At most ${MAX_QUERY_ROWS} rows: aggregate with GROUP BY and use ORDER BY + ` +
    "LIMIT for 'top N'. Give every result column a short, unique alias. Use CURDATE()/NOW() for relative dates. " +
    "Returns a queryId, the columns and the rows (the first 50 here). To show the result to the user, call " +
    `tampilkan with the queryId. If the query fails, read the error, fix it and retry; after ${MAX_QUERY_FAILURES} ` +
    "failures in a row, stop and explain what you could not answer.",
  parameters: Schema.Struct({
    sql: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(10_000)).annotate({
      description: "One SELECT statement.",
    }),
    alasan: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(500)).annotate({
      description: "What this query answers, in one sentence (logged in the audit log).",
    }),
  }),
  output: Schema.Struct({
    queryId: Schema.String,
    sql: Schema.String,
    kolom: Schema.Array(Schema.String),
    jumlahBaris: Schema.Number,
    terpotong: Schema.Boolean,
    baris: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  handler: Effect.fn(NAME)(function* (params) {
    const read = yield* KhanzaRead;
    const results = yield* ResultStore;
    const sessionId = yield* CurrentSession;

    if (sessionId !== null && (yield* results.failuresSinceSuccess(sessionId, NAME)) >= MAX_QUERY_FAILURES) {
      return yield* new ToolError({
        tool: NAME,
        message:
          `Query sudah gagal ${MAX_QUERY_FAILURES} kali berturut-turut, jadi tidak dijalankan lagi. ` +
          "Jelaskan kepada pengguna data apa yang tidak bisa diambil dan kenapa.",
      });
    }

    const tables = (yield* guard(() => referencedTables(params.sql))) as ReadonlyArray<string>;
    const columnRows =
      tables.length === 0
        ? []
        : yield* read.query<{ t: string; c: string }>(
            (sql) => sql`
              SELECT LOWER(TABLE_NAME) AS t, LOWER(COLUMN_NAME) AS c FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN ${sql.in(tables)}`,
          );
    const columns = new Map<string, Array<string>>();
    for (const { t, c } of columnRows) columns.set(t, [...(columns.get(t) ?? []), c]);

    const checked = (yield* guard(() =>
      checkSelect(params.sql, { database: read.database, columnsOf: (t) => columns.get(t) }),
    )) as ReturnType<typeof checkSelect>;

    const raw = yield* read
      .query<Row>((sql) => sql.unsafe(checked.sql))
      .pipe(Effect.catchTag("KhanzaQueryError", (error) => Effect.fail(withHint(error, columns))));
    const truncated = checked.limitAdded && raw.length > MAX_QUERY_ROWS;
    const rows = raw.slice(0, MAX_QUERY_ROWS).map(cleanRow);
    const kolom = Object.keys(rows[0] ?? {});

    const queryId = yield* results.saveResult({
      toolCallId: yield* CurrentToolCall,
      sessionId,
      reason: params.alasan,
      sqlOriginal: params.sql,
      sqlFinal: checked.sql,
      columns: kolom,
      rows,
      truncated,
    });
    return { queryId, sql: checked.sql, kolom, jumlahBaris: rows.length, terpotong: truncated, baris: rows };
  }),
  forModel: (output) => ({
    ...output,
    baris: output.baris.slice(0, ROWS_FOR_MODEL),
    catatan: [
      output.jumlahBaris > ROWS_FOR_MODEL
        ? `Hanya ${ROWS_FOR_MODEL} dari ${output.jumlahBaris} baris dikirim ke sini; tampilkan(queryId) menampilkan semuanya.`
        : null,
      output.terpotong ? `Hasil dipotong di ${MAX_QUERY_ROWS} baris; sebutkan ini atau persempit query.` : null,
    ]
      .filter((n) => n !== null)
      .join(" ") || undefined,
  }),
});

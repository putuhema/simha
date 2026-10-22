/**
 * Checks a proposed fix statement before it is stored. Pure: no database.
 *
 * Accepted: exactly one UPDATE, INSERT or DELETE on one allow-listed table,
 * with the operations that table allows (see FIX_ALLOW_LIST, which mirrors the
 * write user's grants in README.md), and:
 * - UPDATE / DELETE: a WHERE clause; no joins, subqueries, ORDER BY or LIMIT;
 *   UPDATE must not change primary-key columns (rollback finds rows by key).
 * - INSERT: explicit column list, VALUES only, all primary-key columns given
 *   as literal values; no INSERT ... SELECT, IGNORE or ON DUPLICATE KEY.
 *
 * `?` parameters are inlined (escaped by mysql2) so the stored statement is
 * exactly the text a person reviews and the server runs.
 */
import mysql from "mysql2";
import pkg from "node-sql-parser";

const { Parser } = pkg;
const parser = new Parser();
const DIALECT = { database: "MariaDB" } as const;

export type FixKind = "update" | "insert" | "delete";

/** Tables a fix may change, and how. Keep in sync with the write user's grants (README.md). */
export const FIX_ALLOW_LIST: Readonly<Record<string, ReadonlyArray<FixKind>>> = {
  kamar_inap: ["update", "insert", "delete"],
  kamar: ["update"],
  reg_periksa: ["update"],
  rawat_jl_pr: ["delete"],
  rawat_inap_pr: ["delete"],
  bridging_surat_kontrol_bpjs: ["update"],
};

export type FixParam = string | number | boolean | null;

export interface CheckedFix {
  readonly kind: FixKind;
  readonly table: string;
  /** The statement with parameters inlined: what will run. */
  readonly sql: string;
  /** UPDATE / DELETE: SELECT of the rows the statement will touch. */
  readonly previewSql: string | null;
  /** UPDATE: columns that change. */
  readonly setColumns: ReadonlyArray<string>;
  /** INSERT: primary-key values of each new row. */
  readonly insertedKeys: ReadonlyArray<Readonly<Record<string, FixParam>>>;
}

export class FixRejected extends Error {
  override readonly name = "FixRejected";
}

const reject = (message: string): never => {
  throw new FixRejected(message);
};

interface AstNode {
  readonly type?: string;
  readonly [key: string]: unknown;
}

const LITERAL_TYPES = new Set(["single_quote_string", "double_quote_string", "string", "number", "null", "bool", "boolean"]);

const literalValue = (node: AstNode): FixParam | undefined => {
  if (!node.type || !LITERAL_TYPES.has(node.type)) return undefined;
  if (node.type === "null") return null;
  return node["value"] as FixParam;
};

const quote = (identifier: string) => `\`${identifier.replaceAll("`", "``")}\``;

/**
 * Inlines `?` parameters with mysql2's escaping, skipping `?` inside quoted
 * strings, identifiers and comments. Fails when the count does not match.
 */
export const inlineParams = (sql: string, params: ReadonlyArray<FixParam>): string => {
  let out = "";
  let used = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? "";
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== c) j += sql[j] === "\\" && c !== "`" ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j;
    } else if (c === "-" && sql[i + 1] === "-") {
      reject("Komentar SQL tidak diizinkan dalam perbaikan.");
    } else if (c === "#" || (c === "/" && sql[i + 1] === "*")) {
      reject("Komentar SQL tidak diizinkan dalam perbaikan.");
    } else if (c === "?") {
      if (used >= params.length) reject(`SQL punya lebih banyak tanda '?' daripada nilai di params (${params.length}).`);
      out += mysql.escape(params[used++]);
    } else {
      out += c;
    }
  }
  if (used !== params.length) reject(`SQL punya ${used} tanda '?' tetapi params berisi ${params.length} nilai.`);
  return out;
};

/**
 * Checks `sql` (with `params`) against the rules above. `primaryKeyOf`
 * returns the primary-key columns of a table from the live schema.
 */
export const checkFix = (
  rawSql: string,
  params: ReadonlyArray<FixParam>,
  primaryKeyOf: (table: string) => ReadonlyArray<string>,
): CheckedFix => {
  const trimmed = rawSql.trim().replace(/;\s*$/, "");
  if (trimmed === "") reject("SQL kosong.");

  let sql: string;
  let statements: ReadonlyArray<AstNode>;
  try {
    sql = inlineParams(trimmed, params);
    const ast = parser.astify(sql, DIALECT) as unknown as AstNode | ReadonlyArray<AstNode>;
    statements = Array.isArray(ast) ? ast : [ast as AstNode];
  } catch (error) {
    if (error instanceof FixRejected) throw error;
    return reject(`SQL tidak bisa dibaca: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }

  if (statements.length !== 1) reject("Hanya boleh satu statement.");
  const ast = statements[0] as AstNode;
  const kind = ast.type as FixKind;
  if (kind !== "update" && kind !== "insert" && kind !== "delete") {
    reject("Perbaikan harus berupa satu UPDATE, INSERT atau DELETE.");
  }

  const tables = parser.tableList(sql, DIALECT);
  if (tables.length !== 1) reject("Perbaikan hanya boleh menyentuh satu tabel (tanpa JOIN atau subquery).");
  const table = (tables[0] ?? "").split("::")[2] ?? "";
  const allowed = FIX_ALLOW_LIST[table];
  if (!allowed) {
    reject(`Tabel ${table} tidak termasuk daftar tabel yang boleh diubah (${Object.keys(FIX_ALLOW_LIST).join(", ")}).`);
  }
  if (!allowed?.includes(kind)) {
    reject(`${kind.toUpperCase()} tidak diizinkan pada tabel ${table} (boleh: ${allowed?.join(", ").toUpperCase()}).`);
  }
  if (ast["with"]) reject("WITH tidak diizinkan dalam perbaikan.");

  const primaryKey = primaryKeyOf(table);
  if (primaryKey.length === 0) reject(`Tabel ${table} tidak punya primary key; perbaikan tidak bisa di-rollback.`);

  if (kind === "insert") {
    const columns = (ast["columns"] as ReadonlyArray<string> | null) ?? [];
    if (columns.length === 0) reject("INSERT harus menyebut daftar kolom.");
    if (ast["on_duplicate_update"]) reject("ON DUPLICATE KEY UPDATE tidak diizinkan.");
    if (/^\s*insert\s+ignore\b/i.test(sql)) reject("INSERT IGNORE tidak diizinkan.");
    const values = ast["values"] as AstNode | null;
    if (values?.type !== "values") reject("INSERT harus memakai VALUES (bukan SELECT).");
    const rows = (values?.["values"] as ReadonlyArray<AstNode>) ?? [];
    const missing = primaryKey.filter((k) => !columns.includes(k));
    if (missing.length > 0) reject(`INSERT harus mengisi semua kolom primary key: ${missing.join(", ")}.`);
    const insertedKeys = rows.map((row) => {
      const exprs = (row["value"] as ReadonlyArray<AstNode>) ?? [];
      if (exprs.length !== columns.length) reject("Jumlah nilai VALUES tidak sama dengan jumlah kolom.");
      return Object.fromEntries(
        primaryKey.map((k) => {
          const value = literalValue(exprs[columns.indexOf(k)] ?? {});
          if (value === undefined) reject(`Nilai primary key ${k} harus berupa nilai tetap, bukan ekspresi.`);
          return [k, value ?? null];
        }),
      );
    });
    return { kind, table, sql, previewSql: null, setColumns: [], insertedKeys };
  }

  const where = ast["where"] as AstNode | null;
  if (!where) reject(`${kind.toUpperCase()} tanpa WHERE tidak diizinkan.`);
  if (ast["orderby"]) reject("ORDER BY tidak diizinkan dalam perbaikan.");
  if (ast["limit"] && (ast["limit"] as AstNode)["value"] && ((ast["limit"] as AstNode)["value"] as ReadonlyArray<unknown>).length > 0) {
    reject("LIMIT tidak diizinkan dalam perbaikan; persempit WHERE.");
  }

  let setColumns: Array<string> = [];
  if (kind === "update") {
    setColumns = ((ast["set"] as ReadonlyArray<AstNode>) ?? []).map((s) => String(s["column"]));
    const changedKeys = setColumns.filter((c) => primaryKey.includes(c));
    if (changedKeys.length > 0) {
      reject(`UPDATE tidak boleh mengubah kolom primary key (${changedKeys.join(", ")}). Gunakan DELETE + INSERT.`);
    }
  }

  const previewSql = parser.sqlify(
    { type: "select", columns: "*", from: [{ db: null, table, as: null }], where } as never,
    DIALECT,
  );
  return { kind, table, sql, previewSql, setColumns, insertedKeys: [] };
};

/** SQL literal for a value, escaped by mysql2 (same escaping as inlined parameters). */
export const sqlLiteral = (value: FixParam): string => mysql.escape(value);

/** SELECT of rows by primary key (for INSERT previews and after-images). */
export const selectByKeys = (table: string, keys: ReadonlyArray<Readonly<Record<string, FixParam>>>): string => {
  const conditions = keys.map(
    (key) => `(${Object.entries(key).map(([column, value]) => `${quote(column)} <=> ${mysql.escape(value)}`).join(" AND ")})`,
  );
  return `SELECT * FROM ${quote(table)} WHERE ${conditions.join(" OR ") || "FALSE"}`;
};

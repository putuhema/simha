/**
 * Checks a SELECT written by the AI before it runs on the read user. Pure: the
 * caller looks up the columns of the referenced tables first.
 *
 * Accepted: exactly one SELECT (WITH / UNION allowed) on tables of the Khanza
 * database. Rejected:
 * - anything else (UPDATE, SHOW, CALL, SET, several statements), comments,
 *   SELECT ... INTO, FOR UPDATE / LOCK IN SHARE MODE, @variables;
 * - credential tables and dangerous functions (see sensitive.ts);
 * - protected columns (NIK, phone, address, ...) in any SELECT list, except
 *   inside COUNT(). They may be used in WHERE, JOIN, GROUP BY and ORDER BY;
 * - `*` / `t.*` on a table that has protected columns.
 *
 * Rows are capped at MAX_QUERY_ROWS: without a LIMIT, `LIMIT 501` is added so
 * the caller can tell when the result was cut; a larger LIMIT is rejected.
 */
import pkg from "node-sql-parser";
import { DENIED_FUNCTIONS, isCredentialTable, protectedColumn } from "./sensitive.ts";

const { Parser } = pkg;
const parser = new Parser();
const DIALECT = { database: "MariaDB" } as const;

export const MAX_QUERY_ROWS = 500;

export class QueryRejected extends Error {
  override readonly name = "QueryRejected";
}

const reject = (message: string): never => {
  throw new QueryRejected(message);
};

export interface CheckedSelect {
  /** The statement that runs (with the added LIMIT, if any). */
  readonly sql: string;
  /** True when the guard added `LIMIT 501`: more than 500 rows means the result was cut. */
  readonly limitAdded: boolean;
  readonly tables: ReadonlyArray<string>;
}

interface Node {
  readonly type?: string;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null;

/** Text of an identifier that may be a plain string or a quoted-string node. */
const identifier = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (isNode(value)) {
    if (typeof value["value"] === "string") return value["value"];
    if (isNode(value["expr"])) return identifier(value["expr"]);
  }
  return null;
};

const functionName = (node: Node): string => {
  const name = node["name"];
  if (typeof name === "string") return name.toUpperCase();
  const parts = isNode(name) && Array.isArray(name["name"]) ? (name["name"] as ReadonlyArray<unknown>) : [];
  return (identifier(parts.at(-1)) ?? "").toUpperCase();
};

/** Rejects comments outside quoted strings and identifiers (MySQL runs `/*! ... *\/` as code). */
const rejectComments = (sql: string) => {
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== c) j += sql[j] === "\\" && c !== "`" ? 2 : 1;
      i = j;
    } else if ((c === "-" && sql[i + 1] === "-") || c === "#" || (c === "/" && sql[i + 1] === "*")) {
      reject("Komentar SQL tidak diizinkan.");
    }
  }
};

/**
 * Words MariaDB accepts as plain column names and aliases, but the SQL parser
 * treats as keywords (checked against MariaDB 12: `SELECT 1 AS status` runs).
 * Khanza has columns like `status`. `end` is left out: it closes CASE.
 */
const SOFT_KEYWORDS = new Set(["status", "session", "global", "local", "full", "boolean", "json"]);

/**
 * Puts backticks around SOFT_KEYWORDS used as names (not inside strings or
 * backticks, not as a function call), e.g. `stts AS status` -> stts AS `status`.
 * For MariaDB the query means exactly the same.
 */
export const quoteSoftKeywords = (sql: string): string => {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    const c = sql[i] ?? "";
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== c) j += sql[j] === "\\" && c !== "`" ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j] ?? "")) j++;
      const word = sql.slice(i, j);
      const before = sql.slice(0, i).trimEnd().at(-1);
      const after = sql.slice(j).trimStart()[0];
      const isName = SOFT_KEYWORDS.has(word.toLowerCase()) && after !== "(" && before !== "@";
      out += isName ? `\`${word}\`` : word;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

/** Every node in the tree, depth first. */
const walk = (value: unknown, visit: (node: Node) => void) => {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (isNode(value)) {
    visit(value);
    for (const child of Object.values(value)) walk(child, visit);
  }
};

const parse = (rawSql: string): { sql: string; root: Node } => {
  let sql = rawSql.trim().replace(/;\s*$/, "");
  if (sql === "") reject("SQL kosong.");
  rejectComments(sql);
  let ast: unknown;
  try {
    ast = parser.astify(sql, DIALECT);
  } catch (error) {
    // Names like `status` are fine in MariaDB but not for the parser: quote them and try again,
    // instead of sending the AI back for another round.
    const quoted = quoteSoftKeywords(sql);
    try {
      if (quoted === sql) throw error;
      ast = parser.astify(quoted, DIALECT);
      sql = quoted;
    } catch {
      const detail = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
      return reject(
        `SQL tidak bisa dibaca: ${detail}. Kalau ini nama kolom atau alias yang juga kata kunci SQL, ` +
          "beri backtick (mis. `key`) atau pakai alias lain.",
      );
    }
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) reject("Hanya boleh satu query.");
  const root = statements[0] as Node;
  if (root.type !== "select") reject("Hanya query SELECT yang boleh dijalankan (boleh diawali WITH).");
  return { sql, root };
};

/** Table names a SELECT reads (lower case; CTE names included). Throws QueryRejected for non-SELECTs. */
export const referencedTables = (rawSql: string): ReadonlyArray<string> => {
  const { sql } = parse(rawSql);
  return [
    ...new Set(
      parser
        .tableList(sql, DIALECT)
        .map((entry) => (entry.split("::")[2] ?? "").toLowerCase())
        .filter((t) => t !== "" && t !== "null"),
    ),
  ];
};

export interface CheckSelectOptions {
  /** The Khanza database name; other databases are refused. */
  readonly database: string;
  /** Columns of a base table (lower case), or undefined when it is not a table (CTE, unknown). */
  readonly columnsOf: (table: string) => ReadonlyArray<string> | undefined;
}

export const checkSelect = (rawSql: string, options: CheckSelectOptions): CheckedSelect => {
  const { sql, root } = parse(rawSql);

  const entries = parser.tableList(sql, DIALECT).map((entry) => entry.split("::"));
  for (const [, db, table] of entries) {
    if (db && db !== "null" && db.toLowerCase() !== options.database.toLowerCase()) {
      reject(`Hanya tabel di database Khanza (${options.database}) yang boleh dibaca, bukan ${db}.${table}.`);
    }
    if (table && isCredentialTable(table)) reject(`Tabel ${table} berisi data login/kredensial dan tidak boleh dibaca.`);
  }

  const cteNames = new Set<string>();
  walk(root, (node) => {
    if (Array.isArray(node["with"])) {
      for (const cte of node["with"] as ReadonlyArray<Node>) {
        const name = identifier(cte["name"]);
        if (name) cteNames.add(name.toLowerCase());
      }
    }
  });

  const selects: Array<Node> = [];
  walk(root, (node) => {
    if (node.type === "var") reject("Variabel (@ atau @@) tidak diizinkan.");
    if (node.type === "function" && DENIED_FUNCTIONS.has(functionName(node))) {
      reject(`Fungsi ${functionName(node)} tidak diizinkan.`);
    }
    if (node.type === "select") selects.push(node);
  });

  for (const select of selects) {
    const into = select["into"];
    if (isNode(into) && (into.type || into["keyword"])) reject("SELECT ... INTO tidak diizinkan.");
    if (select["locking_read"]) reject("FOR UPDATE / LOCK IN SHARE MODE tidak diizinkan.");
    checkSelectList(select, cteNames, options);
  }

  // The LIMIT of the whole statement sits on the last part of a UNION.
  let last = root;
  while (isNode(last["_next"])) last = last["_next"];
  const limit = isNode(last["limit"]) ? (last["limit"] as Node) : undefined;
  const values = (limit?.["value"] as ReadonlyArray<Node> | undefined) ?? [];
  if (values.length === 0) {
    return { sql: `${sql}\nLIMIT ${MAX_QUERY_ROWS + 1}`, limitAdded: true, tables: referencedTables(sql) };
  }
  const count = limit?.["seperator"] === "," ? values[1] : values[0];
  if (count?.type !== "number" || typeof count["value"] !== "number") reject("LIMIT harus berupa angka.");
  if ((count?.["value"] as number) > MAX_QUERY_ROWS) reject(`LIMIT maksimal ${MAX_QUERY_ROWS} baris.`);
  return { sql, limitAdded: false, tables: referencedTables(sql) };
};

/** Protected columns may not be returned by a SELECT, except counted. */
const checkSelectList = (select: Node, cteNames: ReadonlySet<string>, options: CheckSelectOptions) => {
  // FROM items that are base tables, by alias and by name.
  const sources = new Map<string, string>();
  for (const item of (select["from"] as ReadonlyArray<Node> | null) ?? []) {
    const table = identifier(item["table"])?.toLowerCase();
    if (!table || cteNames.has(table)) continue;
    sources.set(table, table);
    const alias = identifier(item["as"]);
    if (alias) sources.set(alias.toLowerCase(), table);
  }

  const checkStar = (qualifier: string | null) => {
    const tables = qualifier === null ? [...new Set(sources.values())] : [sources.get(qualifier.toLowerCase())];
    for (const table of tables) {
      if (table === undefined) continue; // derived table or CTE: its own SELECT list is checked
      const hidden = (options.columnsOf(table) ?? []).filter((c) => protectedColumn(c) !== undefined);
      if (hidden.length > 0) {
        reject(
          `SELECT * dari tabel ${table} tidak diizinkan karena tabel itu berisi kolom pribadi (${hidden.join(", ")}). ` +
            "Sebutkan kolom yang dibutuhkan saja.",
        );
      }
    }
  };

  const checkExpr = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) checkExpr(item);
      return;
    }
    if (!isNode(value)) return;
    if (value.type === "select" || isNode(value["ast"])) return; // subquery: checked on its own
    if (value.type === "aggr_func" && functionName(value) === "COUNT") return;
    if (value.type === "column_ref") {
      const column = identifier(value["column"]);
      if (column === "*") return checkStar(identifier(value["table"]));
      const reason = column ? protectedColumn(column) : undefined;
      if (reason) {
        reject(
          `Kolom ${column} berisi data pribadi (${reason}) dan tidak boleh ditampilkan. ` +
            "Kolom ini hanya boleh dipakai di WHERE/JOIN/GROUP BY atau dihitung dengan COUNT().",
        );
      }
      return;
    }
    for (const child of Object.values(value)) checkExpr(child);
  };

  const columns = select["columns"];
  if (columns === "*") return checkStar(null);
  for (const column of (columns as ReadonlyArray<Node> | null) ?? []) checkExpr(column["expr"]);
};

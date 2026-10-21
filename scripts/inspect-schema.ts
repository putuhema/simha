/**
 * Dumps the live Khanza schema to docs/schema.md.
 *
 * Connects with the SELECT-only user (KHANZA_DB_READ_*) and reads only
 * information_schema. It never reads patient rows.
 *
 * Usage (from the repo root):
 *   pnpm inspect-schema                     # tables used by the harness
 *   pnpm inspect-schema --all               # + list of every table in the DB
 *   pnpm inspect-schema --tables a,b        # + extra tables, fully documented
 *   pnpm inspect-schema --out path/to.md    # different output file
 */
import { Console, Effect, FileSystem } from "effect";
import { SqlClient } from "effect/sql";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";
import { KHANZA_TABLES } from "./lib/khanza-tables.ts";
import { runKhanzaScript } from "./lib/run-script.ts";
import {
  findMissing,
  renderSchemaMarkdown,
  type ColumnInfo,
  type ForeignKeyInfo,
  type IndexInfo,
  type TableInfo,
} from "./lib/schema-markdown.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: NodePath.join(repoRoot, "docs", "schema.md") },
    tables: { type: "string", default: "" },
    all: { type: "boolean", default: false },
  },
});

const requested = (args.tables ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const tableNames = [...new Set([...KHANZA_TABLES.map((t) => t.name), ...requested])];

const toNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const toStringOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;

  const [meta] = yield* sql<{ db: string; version: string }>`SELECT DATABASE() AS db, VERSION() AS version`;
  const database = meta?.db ?? "";
  yield* Console.log(`Connected to ${database} (${meta?.version ?? "unknown"}). Reading information_schema...`);

  const tableRows = yield* sql<Record<string, unknown>>`
    SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_ROWS AS tableRows, TABLE_COMMENT AS tableComment
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND ${sql.in("TABLE_NAME", tableNames)}`;
  const tables: Array<TableInfo> = tableRows.map((r) => ({
    tableName: String(r["tableName"]),
    engine: toStringOrNull(r["engine"]),
    tableRows: toNumber(r["tableRows"]),
    tableComment: toStringOrNull(r["tableComment"]),
  }));

  const columnRows = yield* sql<Record<string, unknown>>`
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition,
           COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_KEY AS columnKey,
           COLUMN_DEFAULT AS columnDefault, EXTRA AS extra, COLUMN_COMMENT AS columnComment
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND ${sql.in("TABLE_NAME", tableNames)}
    ORDER BY TABLE_NAME, ORDINAL_POSITION`;
  const columns: Array<ColumnInfo> = columnRows.map((r) => ({
    tableName: String(r["tableName"]),
    columnName: String(r["columnName"]),
    ordinalPosition: Number(r["ordinalPosition"]),
    columnType: String(r["columnType"]),
    isNullable: String(r["isNullable"]),
    columnKey: String(r["columnKey"] ?? ""),
    columnDefault: toStringOrNull(r["columnDefault"]),
    extra: String(r["extra"] ?? ""),
    columnComment: String(r["columnComment"] ?? ""),
  }));

  const indexRows = yield* sql<Record<string, unknown>>`
    SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
           SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND ${sql.in("TABLE_NAME", tableNames)}
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;
  const indexes: Array<IndexInfo> = indexRows.map((r) => ({
    tableName: String(r["tableName"]),
    indexName: String(r["indexName"]),
    nonUnique: Number(r["nonUnique"]),
    seqInIndex: Number(r["seqInIndex"]),
    columnName: String(r["columnName"]),
  }));

  const fkRows = yield* sql<Record<string, unknown>>`
    SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
           REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
      AND ${sql.in("TABLE_NAME", tableNames)}
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`;
  const foreignKeys: Array<ForeignKeyInfo> = fkRows.map((r) => ({
    tableName: String(r["tableName"]),
    constraintName: String(r["constraintName"]),
    columnName: String(r["columnName"]),
    referencedTableName: String(r["referencedTableName"]),
    referencedColumnName: String(r["referencedColumnName"]),
  }));

  let allTables: Array<TableInfo & { columnCount: number }> | undefined;
  if (args.all) {
    const rows = yield* sql<Record<string, unknown>>`
      SELECT t.TABLE_NAME AS tableName, t.ENGINE AS engine, t.TABLE_ROWS AS tableRows,
             t.TABLE_COMMENT AS tableComment, COUNT(c.COLUMN_NAME) AS columnCount
      FROM information_schema.TABLES t
      LEFT JOIN information_schema.COLUMNS c
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      WHERE t.TABLE_SCHEMA = DATABASE()
      GROUP BY t.TABLE_NAME, t.ENGINE, t.TABLE_ROWS, t.TABLE_COMMENT`;
    allTables = rows.map((r) => ({
      tableName: String(r["tableName"]),
      engine: toStringOrNull(r["engine"]),
      tableRows: toNumber(r["tableRows"]),
      tableComment: toStringOrNull(r["tableComment"]),
      columnCount: Number(r["columnCount"]),
    }));
  }

  const markdown = renderSchemaMarkdown({
    database,
    serverVersion: meta?.version ?? "unknown",
    generatedAt: new Date(),
    expected: KHANZA_TABLES,
    requested,
    tables,
    columns,
    indexes,
    foreignKeys,
    ...(allTables ? { allTables } : {}),
  });

  yield* fs.makeDirectory(NodePath.dirname(args.out), { recursive: true });
  yield* fs.writeFileString(args.out, markdown);

  const missing = findMissing(KHANZA_TABLES, tables, columns);
  const missingRequested = requested.filter(
    (name) => !tables.some((t) => t.tableName.toLowerCase() === name.toLowerCase()),
  );
  yield* Console.log(`Wrote ${args.out} (${tables.length} tables, ${columns.length} columns).`);
  if (missing.missingTables.length > 0) {
    yield* Console.log(`Missing tables: ${missing.missingTables.join(", ")}`);
  }
  if (missingRequested.length > 0) {
    yield* Console.log(`Requested tables not found: ${missingRequested.join(", ")}`);
  }
  if (missing.missingColumns.length > 0) {
    yield* Console.log(
      `Missing columns: ${missing.missingColumns.map((m) => `${m.table}.${m.column}`).join(", ")}`,
    );
  }
});

runKhanzaScript(program);

/**
 * Turns a proposed statement into a stored, pending fix:
 * guard check -> primary keys from the live schema -> preview of the rows
 * it will touch (read user) -> FixStore. Nothing is written to Khanza here.
 */
import { Effect } from "effect";
import { ToolError, type KhanzaQueryError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { checkFix, FIX_ALLOW_LIST, FixRejected, selectByKeys, type CheckedFix, type FixParam } from "./guard.ts";
import { FixStore, type Fix } from "./FixStore.ts";

/** A fix that would touch more rows than this is refused; narrow the WHERE instead. */
export const MAX_FIX_ROWS = 20;

export interface FixProposal {
  readonly title: string;
  readonly reason: string;
  readonly sql: string;
  readonly params: ReadonlyArray<FixParam>;
}

export interface FixOrigin {
  readonly runId: string | null;
  readonly toolCallId: string | null;
  /** "ai:<provider>/<model>" for the agent, or the IT user's name. */
  readonly createdBy: string;
  readonly ticketId?: string | null;
}

/** Primary-key columns of the allow-listed tables, from the live schema. */
const primaryKeys = Effect.gen(function* () {
  const read = yield* KhanzaRead;
  const rows = yield* read.query(
    (sql) => sql<{ tableName: string; columnName: string }>`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = 'PRIMARY'
        AND ${sql.in("TABLE_NAME", Object.keys(FIX_ALLOW_LIST))}
      ORDER BY TABLE_NAME, SEQ_IN_INDEX`,
  );
  const keys = new Map<string, Array<string>>();
  for (const r of rows) keys.set(r.tableName, [...(keys.get(r.tableName) ?? []), r.columnName]);
  return keys;
});

const fail = (tool: string, message: string) => Effect.fail(new ToolError({ tool, message }));

export const planFix = (
  tool: string,
  proposal: FixProposal,
  origin: FixOrigin,
): Effect.Effect<Fix, ToolError | KhanzaQueryError, KhanzaRead | FixStore> =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const store = yield* FixStore;
    const keys = yield* primaryKeys;

    let checked: CheckedFix;
    try {
      checked = checkFix(proposal.sql, proposal.params, (table) => keys.get(table) ?? []);
    } catch (error) {
      if (error instanceof FixRejected) return yield* fail(tool, error.message);
      throw error;
    }

    let preview: ReadonlyArray<Record<string, unknown>> = [];
    let expectedRows: number;
    if (checked.kind === "insert") {
      const existing = yield* read.query((sql) => sql.unsafe<Record<string, unknown>>(selectByKeys(checked.table, checked.insertedKeys)));
      if (existing.length > 0) {
        return yield* fail(tool, `Baris dengan primary key yang sama sudah ada di ${checked.table}: ${JSON.stringify(existing[0])}`);
      }
      expectedRows = checked.insertedKeys.length;
    } else {
      preview = yield* read.query((sql) =>
        sql.unsafe<Record<string, unknown>>(`${checked.previewSql ?? ""} LIMIT ${MAX_FIX_ROWS + 1}`),
      );
      expectedRows = preview.length;
      if (expectedRows === 0) {
        return yield* fail(tool, "WHERE tidak cocok dengan baris mana pun, jadi tidak ada yang perlu diubah. Periksa nilainya.");
      }
    }
    if (expectedRows > MAX_FIX_ROWS) {
      return yield* fail(tool, `Perbaikan akan mengubah lebih dari ${MAX_FIX_ROWS} baris. Persempit WHERE.`);
    }

    return yield* store.create({
      runId: origin.runId,
      toolCallId: origin.toolCallId,
      ticketId: origin.ticketId ?? null,
      createdBy: origin.createdBy,
      title: proposal.title,
      reason: proposal.reason,
      kind: checked.kind,
      table: checked.table,
      sqlOriginal: proposal.sql,
      params: proposal.params,
      sql: checked.sql,
      expectedRows,
      primaryKey: keys.get(checked.table) ?? [],
      preview,
    });
  });

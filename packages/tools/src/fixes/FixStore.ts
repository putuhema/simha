/**
 * Proposed fixes and their history, in the audit SQLite DB.
 *
 * Status flow:
 *   pending -> approved -> applied -> rolled_back
 *                      \-> failed
 *   pending -> rejected
 *
 * Every step also appends a row to fix_events (who, what, when). The
 * executor refuses to touch Khanza unless an 'approved' event exists.
 */
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import type { FixKind, FixParam } from "./guard.ts";

export type FixStatus = "pending" | "approved" | "applied" | "failed" | "rejected" | "rolled_back";

export type FixAction =
  | "proposed"
  | "approved"
  | "rejected"
  | "applied"
  | "apply_failed"
  | "rollback_requested"
  | "rolled_back"
  | "rollback_failed";

export type Row = Readonly<Record<string, unknown>>;

export interface Fix {
  readonly id: string;
  readonly runId: string | null;
  readonly toolCallId: string | null;
  readonly ticketId: string | null;
  readonly title: string;
  readonly reason: string;
  readonly kind: FixKind;
  readonly table: string;
  readonly sqlOriginal: string;
  readonly params: ReadonlyArray<FixParam>;
  /** The exact statement that runs on approval. */
  readonly sql: string;
  readonly expectedRows: number;
  readonly primaryKey: ReadonlyArray<string>;
  /** UPDATE/DELETE: rows that will change, as read at proposal time. INSERT: empty. */
  readonly preview: ReadonlyArray<Row>;
  readonly status: FixStatus;
  /** Rows as they were just before the fix ran (the rollback source). */
  readonly before: ReadonlyArray<Row> | null;
  /** Rows as the fix left them (rollback checks nothing changed since). */
  readonly after: ReadonlyArray<Row> | null;
  readonly error: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FixEvent {
  readonly id: number;
  readonly action: FixAction;
  readonly actor: string;
  readonly detail: string | null;
  readonly at: string;
}

interface NewFix {
  readonly runId: string | null;
  readonly toolCallId: string | null;
  readonly title: string;
  readonly reason: string;
  readonly kind: FixKind;
  readonly table: string;
  readonly sqlOriginal: string;
  readonly params: ReadonlyArray<FixParam>;
  readonly sql: string;
  readonly expectedRows: number;
  readonly primaryKey: ReadonlyArray<string>;
  readonly preview: ReadonlyArray<Row>;
  readonly createdBy: string;
  /** Set when an IT person proposes the fix directly (e.g. an edited AI proposal). */
  readonly ticketId?: string | null;
}

interface FixRow {
  readonly id: string;
  readonly run_id: string | null;
  readonly tool_call_id: string | null;
  readonly ticket_id: string | null;
  readonly title: string;
  readonly reason: string;
  readonly kind: FixKind;
  readonly table_name: string;
  readonly sql_original: string;
  readonly params_json: string;
  readonly sql_final: string;
  readonly expected_rows: number;
  readonly primary_key: string;
  readonly preview_json: string;
  readonly status: FixStatus;
  readonly before_json: string | null;
  readonly after_json: string | null;
  readonly error: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const parse = <A>(json: string | null): A | null => (json === null ? null : (JSON.parse(json) as A));

const toFix = (r: FixRow): Fix => ({
  id: r.id,
  runId: r.run_id,
  toolCallId: r.tool_call_id,
  ticketId: r.ticket_id,
  title: r.title,
  reason: r.reason,
  kind: r.kind,
  table: r.table_name,
  sqlOriginal: r.sql_original,
  params: parse<ReadonlyArray<FixParam>>(r.params_json) ?? [],
  sql: r.sql_final,
  expectedRows: r.expected_rows,
  primaryKey: parse<ReadonlyArray<string>>(r.primary_key) ?? [],
  preview: parse<ReadonlyArray<Row>>(r.preview_json) ?? [],
  status: r.status,
  before: parse<ReadonlyArray<Row>>(r.before_json),
  after: parse<ReadonlyArray<Row>>(r.after_json),
  error: r.error,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const now = () => new Date().toISOString();

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const addEvent = (fixId: string, action: FixAction, actor: string, detail: string | null = null) =>
    sql`INSERT INTO fix_events ${sql.insert({ fix_id: fixId, action, actor, detail, at: now() })}`.pipe(
      Effect.asVoid,
      Effect.orDie,
    );

  const get = (id: string) =>
    sql<FixRow>`SELECT * FROM fixes WHERE id = ${id}`.pipe(
      Effect.map((rows) => (rows[0] ? toFix(rows[0]) : undefined)),
      Effect.orDie,
    );

  const create = (input: NewFix) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID();
      // A fix proposed by the agent belongs to the ticket of its run, if any.
      const ticketId =
        input.ticketId ??
        (input.runId === null
          ? null
          : ((yield* sql<{ ticket_id: string | null }>`SELECT ticket_id FROM agent_runs WHERE id = ${input.runId}`)[0]
              ?.ticket_id ?? null));
      const at = now();
      yield* sql`INSERT INTO fixes ${sql.insert({
        id,
        run_id: input.runId,
        tool_call_id: input.toolCallId,
        ticket_id: ticketId,
        title: input.title,
        reason: input.reason,
        kind: input.kind,
        table_name: input.table,
        sql_original: input.sqlOriginal,
        params_json: JSON.stringify(input.params),
        sql_final: input.sql,
        expected_rows: input.expectedRows,
        primary_key: JSON.stringify(input.primaryKey),
        preview_json: JSON.stringify(input.preview),
        status: "pending",
        created_by: input.createdBy,
        created_at: at,
        updated_at: at,
      })}`;
      yield* addEvent(id, "proposed", input.createdBy, input.reason);
      return (yield* get(id)) as Fix;
    }).pipe(Effect.orDie);

  const list = (filter: { readonly status?: FixStatus | undefined; readonly ticketId?: string | undefined } = {}) =>
    sql<FixRow>`
      SELECT * FROM fixes
      WHERE ${filter.status ? sql`status = ${filter.status}` : sql`1 = 1`}
        AND ${filter.ticketId ? sql`ticket_id = ${filter.ticketId}` : sql`1 = 1`}
      ORDER BY created_at DESC LIMIT 200`.pipe(
      Effect.map((rows) => rows.map(toFix)),
      Effect.orDie,
    );

  const events = (fixId: string) =>
    sql<FixEvent>`SELECT id, action, actor, detail, at FROM fix_events WHERE fix_id = ${fixId} ORDER BY id`.pipe(
      Effect.orDie,
    );

  /**
   * Moves a fix from one of `from` to `to` atomically. Returns false when the
   * fix was not in an allowed state (e.g. two people clicked Approve at once).
   */
  const transition = (
    id: string,
    from: ReadonlyArray<FixStatus>,
    to: FixStatus,
    patch: { readonly before?: ReadonlyArray<Row>; readonly after?: ReadonlyArray<Row>; readonly error?: string | null } = {},
  ) =>
    sql<{ id: string }>`
      UPDATE fixes SET ${sql.update({
        status: to,
        updated_at: now(),
        ...(patch.before ? { before_json: JSON.stringify(patch.before) } : {}),
        ...(patch.after ? { after_json: JSON.stringify(patch.after) } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      })}
      WHERE id = ${id} AND ${sql.in("status", from)}
      RETURNING id`.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.orDie,
    );

  /** The approval row the executor requires before it writes to Khanza. */
  const approvalOf = (fixId: string) =>
    sql<FixEvent>`
      SELECT id, action, actor, detail, at FROM fix_events
      WHERE fix_id = ${fixId} AND action = 'approved' ORDER BY id DESC LIMIT 1`.pipe(
      Effect.map((rows) => rows[0]),
      Effect.orDie,
    );

  return { create, get, list, events, transition, addEvent, approvalOf };
});

export class FixStore extends Context.Service<FixStore, Effect.Success<typeof make>>()("simrs/FixStore") {}

/** Needs the audit DB's SqlClient (provided by AuditLogLive / AuditLogMemory). */
export const FixStoreLive = Layer.effect(FixStore, make);

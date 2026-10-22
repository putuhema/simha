/**
 * Audit log in a separate SQLite database (never in Khanza).
 *
 * Append-only from the app's point of view: rows are inserted, and a tool
 * call row is updated once when it finishes. Nothing is deleted.
 */
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Context, Effect, Layer } from "effect";
import { Migrator, SqlClient } from "effect/sql";
import { mkdirSync } from "node:fs";
import * as NodePath from "node:path";
import { AuditDbPathConfig } from "../config.ts";
import { auditMigrations } from "./migrations.ts";

/** Longest JSON stored per field; larger outputs are cut and marked. */
const MAX_JSON_CHARS = 50_000;

export interface ToolCallStart {
  readonly id: string;
  readonly sessionId: string | null;
  readonly tool: string;
  readonly kind: string;
  readonly input: unknown;
}

export interface ToolCallEnd {
  readonly id: string;
  readonly status: "ok" | "error";
  readonly output?: unknown;
  readonly error?: string;
  readonly durationMs: number;
}

export interface QueryRecord {
  readonly toolCallId: string | null;
  /** Set for statements run by the fix executor (write pool). */
  readonly fixId?: string | null;
  readonly pool: "read" | "write";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
  readonly rowCount: number | null;
  readonly durationMs: number;
  readonly error: string | null;
}

export interface AuditLogService {
  readonly toolCallStarted: (entry: ToolCallStart) => Effect.Effect<void>;
  readonly toolCallFinished: (entry: ToolCallEnd) => Effect.Effect<void>;
  readonly query: (entry: QueryRecord) => Effect.Effect<void>;
}

const toJson = (value: unknown): string => {
  const json = JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)) ?? "null";
  return json.length > MAX_JSON_CHARS ? `${json.slice(0, MAX_JSON_CHARS)}…[truncated ${json.length} chars]` : json;
};

const now = () => new Date().toISOString();

/**
 * Builds the audit log on top of an SQLite client. Audit writes must never be
 * lost silently: a failure to write the audit row is a defect (it stops the
 * request) rather than an ignored error.
 */
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const toolCallStarted = (e: ToolCallStart) =>
    sql`INSERT INTO tool_calls ${sql.insert({
      id: e.id,
      session_id: e.sessionId,
      tool: e.tool,
      kind: e.kind,
      input_json: toJson(e.input),
      status: "running",
      started_at: now(),
    })}`.pipe(Effect.asVoid, Effect.orDie);

  const toolCallFinished = (e: ToolCallEnd) =>
    sql`UPDATE tool_calls SET ${sql.update({
      status: e.status,
      output_json: e.output === undefined ? null : toJson(e.output),
      error: e.error ?? null,
      finished_at: now(),
      duration_ms: Math.round(e.durationMs),
    })} WHERE id = ${e.id}`.pipe(Effect.asVoid, Effect.orDie);

  const query = (e: QueryRecord) =>
    sql`INSERT INTO queries ${sql.insert({
      tool_call_id: e.toolCallId,
      fix_id: e.fixId ?? null,
      pool: e.pool,
      sql: e.sql,
      params_json: toJson(e.params),
      row_count: e.rowCount,
      duration_ms: Math.round(e.durationMs),
      error: e.error,
      executed_at: now(),
    })}`.pipe(Effect.asVoid, Effect.orDie);

  return { toolCallStarted, toolCallFinished, query } satisfies AuditLogService;
});

export class AuditLog extends Context.Service<AuditLog, AuditLogService>()("simrs/AuditLog") {}

const migrations = SqliteMigrator.layer({ loader: Migrator.fromRecord(auditMigrations) });

/** Audit log on an SQLite file (created if missing) with migrations applied. */
export const auditLogLayerFile = (filename: string) => {
  const client = Layer.unwrap(
    Effect.sync(() => {
      if (filename !== ":memory:") mkdirSync(NodePath.dirname(NodePath.resolve(filename)), { recursive: true });
      return SqliteClient.layer({ filename });
    }),
  );
  return Layer.effect(AuditLog, make).pipe(Layer.provideMerge(migrations), Layer.provideMerge(client));
};

/** Audit log at AUDIT_DB_PATH (default data/audit.sqlite). */
export const AuditLogLive = Layer.unwrap(Effect.map(AuditDbPathConfig, auditLogLayerFile));

/** In-memory audit log for tests. Also provides the SqlClient so tests can inspect rows. */
export const AuditLogMemory = auditLogLayerFile(":memory:");

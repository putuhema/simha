/**
 * Read access to Khanza through the SELECT-only database user.
 *
 * Every query goes through `query`, which:
 * - refuses anything that does not start with SELECT/WITH,
 * - adds a server-side time limit plus an Effect timeout as a backstop,
 * - retries short connection hiccups,
 * - writes the statement, parameters, row count and duration to the audit log.
 *
 * At startup the layer checks `SHOW GRANTS` and refuses to start if the read
 * user can change data.
 */
import { Context, Duration, Effect, Layer, Schedule } from "effect";
import type { SqlClient, Statement } from "effect/sql";
import { type SqlError } from "effect/sql/SqlError";
import { AuditLog } from "../audit/AuditLog.ts";
import { KhanzaReadConfig, QueryTimeoutConfig, type KhanzaConnectionOptions } from "../config.ts";
import { KhanzaQueryError, KhanzaSetupError } from "../errors.ts";
import { connectKhanza } from "./connect.ts";
import { CurrentToolCall } from "./current-tool-call.ts";
import { findWritePrivileges } from "./grants.ts";
import { detectServer, looksReadOnly, withStatementTimeout, type ServerInfo } from "./server.ts";

export interface KhanzaReadService {
  readonly server: ServerInfo;
  /** The Khanza database name (e.g. "sik"). */
  readonly database: string;
  /**
   * Runs one read query. `build` receives the SQL template tag; use
   * `${value}` for every value so it is sent as a parameter.
   */
  readonly query: <A extends object>(
    build: (sql: Statement.Constructor) => Statement.Statement<A>,
  ) => Effect.Effect<ReadonlyArray<A>, KhanzaQueryError>;
}

export class KhanzaRead extends Context.Service<KhanzaRead, KhanzaReadService>()("simrs/KhanzaRead") {}

/** Turns a driver error into a short message the AI model and the user can understand. */
const describeSqlError = (error: SqlError): KhanzaQueryError => {
  const cause = error.reason.cause;
  const detail = cause instanceof Error ? cause.message : error.message;
  switch (error.reason._tag) {
    case "StatementTimeoutError":
      return new KhanzaQueryError({ kind: "timeout", message: `Query dihentikan karena terlalu lama: ${detail}` });
    case "SqlSyntaxError":
      return new KhanzaQueryError({ kind: "syntax", message: detail });
    case "ConnectionError":
    case "AuthenticationError":
      return new KhanzaQueryError({ kind: "connection", message: `Tidak bisa terhubung ke database Khanza: ${detail}` });
    case "AuthorizationError":
      return new KhanzaQueryError({ kind: "permission", message: detail });
    default:
      // MariaDB reports max_statement_time as error 1969 ("Query execution was interrupted").
      return /max_statement_time|max_execution_time|interrupted/i.test(detail)
        ? new KhanzaQueryError({ kind: "timeout", message: `Query dihentikan karena terlalu lama: ${detail}` })
        : new KhanzaQueryError({ kind: "other", message: detail });
  }
};

export interface KhanzaReadOptions {
  readonly connection: KhanzaConnectionOptions;
  readonly timeout: Duration.Duration;
}

const makeKhanzaRead = Effect.fn("makeKhanzaRead")(function* (options: KhanzaReadOptions) {
  const audit = yield* AuditLog;
  const sql: SqlClient.SqlClient = yield* connectKhanza(options.connection, 5);

  const [meta] = yield* sql<{ version: string; database: string }>`SELECT VERSION() AS version, DATABASE() AS \`database\``;
  const server = detectServer(meta?.version ?? "");

  const grants = yield* sql.unsafe<Record<string, string>>("SHOW GRANTS");
  const unsafe = findWritePrivileges(grants.map((row) => Object.values(row)[0] ?? ""));
  if (unsafe.length > 0) {
    return yield* new KhanzaSetupError({
      message:
        `KHANZA_DB_READ_USER (${options.connection.username}) can change data, so the harness refuses to use it.\n` +
        `Create a SELECT-only user (see README.md) and put it in .env. Grants found:\n  ${unsafe.join("\n  ")}`,
    });
  }

  const query = <A extends object>(build: (sql: Statement.Constructor) => Statement.Statement<A>) =>
    Effect.gen(function* () {
      const [text, params] = build(sql).compile();
      const toolCallId = yield* CurrentToolCall;
      const started = performance.now();
      const record = (rowCount: number | null, error: string | null) =>
        audit.query({
          toolCallId,
          pool: "read",
          sql: text,
          params,
          rowCount,
          durationMs: performance.now() - started,
          error,
        });

      if (!looksReadOnly(text)) {
        const error = new KhanzaQueryError({ kind: "rejected", message: "Hanya query SELECT yang boleh dijalankan." });
        yield* record(null, error.message);
        return yield* error;
      }

      const rows = yield* sql.unsafe<A>(withStatementTimeout(text, server, options.timeout), params).pipe(
        Effect.retry({
          schedule: Schedule.exponential("200 millis"),
          times: 2,
          while: (e: SqlError) => e.reason._tag === "ConnectionError",
        }),
        Effect.mapError(describeSqlError),
        Effect.timeoutOrElse({
          duration: Duration.sum(options.timeout, Duration.seconds(2)),
          orElse: () =>
            Effect.fail(new KhanzaQueryError({ kind: "timeout", message: "Query dihentikan karena terlalu lama." })),
        }),
        Effect.tapError((e) => record(null, e.message)),
      );
      yield* record(rows.length, null);
      return rows;
    });

  return KhanzaRead.of({ server, database: meta?.database ?? options.connection.database, query });
});

/** Layer from explicit options (tests, scripts). */
export const khanzaReadLayer = (options: KhanzaReadOptions) => Layer.effect(KhanzaRead, makeKhanzaRead(options));

/** Layer from .env: KHANZA_DB_HOST/PORT/NAME, KHANZA_DB_READ_USER/PASS, KHANZA_QUERY_TIMEOUT. */
export const KhanzaReadLive = Layer.unwrap(
  Effect.map(Effect.all({ connection: KhanzaReadConfig, timeout: QueryTimeoutConfig }), khanzaReadLayer),
);

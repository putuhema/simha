/**
 * Audit DB schema (SQLite). Add new migrations at the end; never edit old ones.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

const init = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // One row per tool run, from the agent, the MCP server or a test.
  yield* sql`
    CREATE TABLE tool_calls (
      id           TEXT PRIMARY KEY,
      session_id   TEXT,
      tool         TEXT NOT NULL,
      kind         TEXT NOT NULL,
      input_json   TEXT NOT NULL,
      status       TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
      output_json  TEXT,
      error        TEXT,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      duration_ms  INTEGER
    )`;
  yield* sql`CREATE INDEX tool_calls_session ON tool_calls (session_id, started_at)`;
  // Every statement sent to Khanza, with its parameters and result size.
  yield* sql`
    CREATE TABLE queries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_call_id  TEXT REFERENCES tool_calls (id),
      pool          TEXT NOT NULL CHECK (pool IN ('read', 'write')),
      sql           TEXT NOT NULL,
      params_json   TEXT NOT NULL,
      row_count     INTEGER,
      duration_ms   INTEGER NOT NULL,
      error         TEXT,
      executed_at   TEXT NOT NULL
    )`;
  yield* sql`CREATE INDEX queries_tool_call ON queries (tool_call_id)`;
});

export const auditMigrations = {
  "0001_init": init,
};

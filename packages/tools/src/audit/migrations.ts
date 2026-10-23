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

const agent = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Nurse complaints handled in Tiket mode.
  yield* sql`
    CREATE TABLE tickets (
      id          TEXT PRIMARY KEY,
      nurse_name  TEXT NOT NULL,
      unit        TEXT NOT NULL,
      complaint   TEXT NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'diagnosed', 'closed')),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )`;
  // A chat thread (Tanya Data) or the thread of one ticket. Follow-up questions continue it.
  yield* sql`
    CREATE TABLE conversations (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('ask', 'ticket')),
      ticket_id   TEXT REFERENCES tickets (id),
      created_at  TEXT NOT NULL
    )`;
  yield* sql`CREATE UNIQUE INDEX conversations_ticket ON conversations (ticket_id) WHERE ticket_id IS NOT NULL`;
  // Messages exactly as kept for the AI model (user, assistant, tool results), in order.
  yield* sql`
    CREATE TABLE conversation_messages (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id  TEXT NOT NULL REFERENCES conversations (id),
      run_id           TEXT NOT NULL,
      role             TEXT NOT NULL,
      message_json     TEXT NOT NULL,
      created_at       TEXT NOT NULL
    )`;
  yield* sql`CREATE INDEX conversation_messages_conversation ON conversation_messages (conversation_id, id)`;
  // One row per question: who asked what, which provider/model answered, and the outcome.
  // tool_calls.session_id holds the run id.
  yield* sql`
    CREATE TABLE agent_runs (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL REFERENCES conversations (id),
      ticket_id        TEXT REFERENCES tickets (id),
      kind             TEXT NOT NULL CHECK (kind IN ('ask', 'ticket')),
      question         TEXT NOT NULL,
      provider         TEXT NOT NULL,
      model            TEXT NOT NULL,
      mask_pii         INTEGER NOT NULL,
      status           TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error', 'interrupted')),
      final_text       TEXT,
      stop_reason      TEXT,
      steps            INTEGER NOT NULL DEFAULT 0,
      input_tokens     INTEGER,
      output_tokens    INTEGER,
      error            TEXT,
      started_at       TEXT NOT NULL,
      finished_at      TEXT
    )`;
  yield* sql`CREATE INDEX agent_runs_started ON agent_runs (started_at)`;
});

const fixes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A proposed change to Khanza. It only runs after an 'approved' row exists in fix_events.
  yield* sql`
    CREATE TABLE fixes (
      id              TEXT PRIMARY KEY,
      run_id          TEXT,
      tool_call_id    TEXT,
      ticket_id       TEXT REFERENCES tickets (id),
      title           TEXT NOT NULL,
      reason          TEXT NOT NULL,
      kind            TEXT NOT NULL CHECK (kind IN ('update', 'insert', 'delete')),
      table_name      TEXT NOT NULL,
      sql_original    TEXT NOT NULL,
      params_json     TEXT NOT NULL,
      sql_final       TEXT NOT NULL,
      expected_rows   INTEGER NOT NULL,
      primary_key     TEXT NOT NULL,
      preview_json    TEXT NOT NULL,
      status          TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'applied', 'failed', 'rejected', 'rolled_back')),
      before_json     TEXT,
      after_json      TEXT,
      error           TEXT,
      created_by      TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )`;
  yield* sql`CREATE INDEX fixes_ticket ON fixes (ticket_id, created_at)`;
  // Who did what to a fix, in order. Never updated or deleted.
  yield* sql`
    CREATE TABLE fix_events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      fix_id   TEXT NOT NULL REFERENCES fixes (id),
      action   TEXT NOT NULL CHECK (action IN (
                 'proposed', 'approved', 'rejected', 'applied', 'apply_failed',
                 'rollback_requested', 'rolled_back', 'rollback_failed')),
      actor    TEXT NOT NULL,
      detail   TEXT,
      at       TEXT NOT NULL
    )`;
  yield* sql`CREATE INDEX fix_events_fix ON fix_events (fix_id, id)`;
  // Write queries are linked to the fix they belong to.
  yield* sql`ALTER TABLE queries ADD COLUMN fix_id TEXT REFERENCES fixes (id)`;
});

const tanyaData = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Results of jalankanQueryBaca (max 500 rows), so tampilkan can show them without the AI copying data.
  yield* sql`
    CREATE TABLE query_results (
      id            TEXT PRIMARY KEY,
      tool_call_id  TEXT REFERENCES tool_calls (id),
      session_id    TEXT,
      reason        TEXT NOT NULL,
      sql_original  TEXT NOT NULL,
      sql_final     TEXT NOT NULL,
      columns_json  TEXT NOT NULL,
      rows_json     TEXT NOT NULL,
      row_count     INTEGER NOT NULL,
      truncated     INTEGER NOT NULL,
      created_at    TEXT NOT NULL
    )`;
  // Tables, charts and numbers shown in the chat, so a conversation can be shown again.
  yield* sql`
    CREATE TABLE render_blocks (
      id            TEXT PRIMARY KEY,
      query_id      TEXT NOT NULL REFERENCES query_results (id),
      tool_call_id  TEXT REFERENCES tool_calls (id),
      session_id    TEXT,
      block_json    TEXT NOT NULL,
      created_at    TEXT NOT NULL
    )`;
  yield* sql`CREATE INDEX render_blocks_session ON render_blocks (session_id, created_at)`;
  // "Pertanyaan favorit": question + SQL + how to show it, re-run without the AI.
  yield* sql`
    CREATE TABLE favorites (
      id          TEXT PRIMARY KEY,
      question    TEXT NOT NULL,
      title       TEXT NOT NULL,
      sql         TEXT NOT NULL,
      render_type TEXT NOT NULL,
      options_json TEXT NOT NULL,
      assumptions TEXT,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    )`;
});

const auth = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // IT staff who can log in. Passwords are scrypt hashes; usernames are case-insensitive.
  yield* sql`
    CREATE TABLE users (
      id             TEXT PRIMARY KEY,
      username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name   TEXT NOT NULL,
      password_hash  TEXT NOT NULL,
      role           TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    )`;
  // Login sessions. Only a SHA-256 hash of the cookie token is stored.
  yield* sql`
    CREATE TABLE sessions (
      token_hash    TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users (id),
      created_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL
    )`;
  // Logins, logouts, account and settings changes.
  yield* sql`
    CREATE TABLE app_events (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      action  TEXT NOT NULL,
      actor   TEXT,
      detail  TEXT,
      ip      TEXT,
      at      TEXT NOT NULL
    )`;
  // Settings changed in the app (e.g. the AI provider); override .env.
  yield* sql`
    CREATE TABLE settings (
      key         TEXT PRIMARY KEY,
      value_json  TEXT NOT NULL,
      updated_by  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )`;
  // Who asked each question and who created each ticket.
  yield* sql`ALTER TABLE agent_runs ADD COLUMN asked_by TEXT`;
  yield* sql`ALTER TABLE tickets ADD COLUMN created_by TEXT`;
});

const documents = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Patient documents (riwayat, CPPT, resume) as generated, so what was printed can be shown again.
  yield* sql`
    CREATE TABLE documents (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL CHECK (kind IN ('riwayat', 'cppt', 'resume')),
      title         TEXT NOT NULL,
      subject       TEXT NOT NULL,
      summary       TEXT NOT NULL,
      session_id    TEXT,
      tool_call_id  TEXT REFERENCES tool_calls (id),
      actor         TEXT,
      html          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    )`;
  yield* sql`CREATE INDEX documents_session ON documents (session_id, created_at)`;
});

const formDrafts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Drafts of Khanza forms (resume medis): filled from data, by the AI and by the user, then put into
  // Khanza's own form by the desktop app. Never written to Khanza by the harness.
  yield* sql`
    CREATE TABLE form_drafts (
      id            TEXT PRIMARY KEY,
      form          TEXT NOT NULL,
      no_rawat      TEXT NOT NULL,
      subject       TEXT NOT NULL,
      existing      INTEGER NOT NULL DEFAULT 0,
      fields_json   TEXT NOT NULL,
      sources_json  TEXT NOT NULL,
      session_id    TEXT,
      tool_call_id  TEXT REFERENCES tool_calls (id),
      created_by    TEXT,
      created_at    TEXT NOT NULL,
      updated_by    TEXT,
      updated_at    TEXT NOT NULL
    )`;
  yield* sql`CREATE INDEX form_drafts_session ON form_drafts (session_id, created_at)`;
});

const knowledge = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // What the AI learned about this hospital: questions with the SQL that answered them, and notes.
  // The most similar active items are added to each question sent to the AI.
  yield* sql`
    CREATE TABLE knowledge (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL CHECK (kind IN ('example', 'note')),
      source        TEXT NOT NULL CHECK (source IN ('auto', 'feedback', 'ai', 'staff')),
      text          TEXT NOT NULL,
      sql           TEXT,
      render_type   TEXT,
      title         TEXT,
      verified      INTEGER NOT NULL DEFAULT 0,
      active        INTEGER NOT NULL DEFAULT 1,
      block_id      TEXT,
      run_id        TEXT,
      created_by    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      uses          INTEGER NOT NULL DEFAULT 0,
      last_used_at  TEXT
    )`;
  yield* sql`CREATE INDEX knowledge_block ON knowledge (block_id)`;
});

const cacheUsage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // How much of a run's input came from the provider's prompt cache and how
  // much it wrote into it, so the audit log can show whether caching works.
  yield* sql`ALTER TABLE agent_runs ADD COLUMN cached_input_tokens INTEGER`;
  yield* sql`ALTER TABLE agent_runs ADD COLUMN cache_write_tokens INTEGER`;
});

const threadActions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Pin/archive/remove for Tanya Data threads. Timestamps keep the order and
  // the audit trail; a removed thread keeps its runs but loses its messages.
  yield* sql`ALTER TABLE conversations ADD COLUMN pinned_at TEXT`;
  yield* sql`ALTER TABLE conversations ADD COLUMN archived_at TEXT`;
  yield* sql`ALTER TABLE conversations ADD COLUMN deleted_at TEXT`;
});

export const auditMigrations = {
  "0001_init": init,
  "0002_agent": agent,
  "0003_fixes": fixes,
  "0004_tanya_data": tanyaData,
  "0005_auth": auth,
  "0006_documents": documents,
  "0007_form_drafts": formDrafts,
  "0008_knowledge": knowledge,
  "0009_cache_usage": cacheUsage,
  "0010_thread_actions": threadActions,
};

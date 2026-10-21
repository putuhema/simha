# SIMRS Harness

AI assistant for hospital IT staff working with **SIMRS Khanza**.

- **Tiket mode:** paste a nurse's complaint. The agent reads the real patient data through safe, read-only tools, explains each check, gives a diagnosis and proposes a fix as SQL. The fix only runs after a person clicks **Approve**, and it can be rolled back.
- **Tanya Data mode:** ask questions about hospital data in plain Indonesian ("10 obat paling banyak dipakai minggu ini"). The agent writes a guarded `SELECT` and shows the answer as a table, chart or number.

> Status: **M2 done** (database layer, audit log, read tools, AI agent with streaming HTTP API). No UI yet; use `pnpm tool` and `curl`. See [docs/PLAN.md](docs/PLAN.md).

## Safety model (short version)

| Rule | How |
|---|---|
| Read-only by default | Agent tools use a MySQL user with `SELECT` only. The harness checks `SHOW GRANTS` at startup and refuses to run if that user can change data. |
| Writes need approval | The AI can only *propose* a fix. After Approve, the server runs it with a separate write user, in a transaction, and rolls back if the affected row count differs from the preview. |
| Every fix can be undone | The affected rows are saved (before-image) before the change runs. |
| Audit everything | Questions, tool calls, queries, fixes, approvals, rollbacks and the AI model used are logged in a separate SQLite DB, never in Khanza. |
| Patient privacy | NIK, phone numbers and addresses are masked before data goes to an external AI provider. |

## Requirements

- Node.js 24+
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Network access to the Khanza MySQL/MariaDB server

## Setup

```bash
pnpm install
cp .env.example .env     # then fill in the values
```

### 1. Create the two database users

Run this as a MySQL/MariaDB admin. Replace `sik` with your Khanza database name, and `'10.0.0.%'` with the IP (or range) of the machine that runs the harness server. Use strong passwords.

```sql
-- Read user: SELECT only. Used by every agent tool, Tanya Data and inspect-schema.
CREATE USER 'harness_read'@'10.0.0.%' IDENTIFIED BY 'change-me-read'
  WITH MAX_USER_CONNECTIONS 5;
GRANT SELECT ON sik.* TO 'harness_read'@'10.0.0.%';

-- Write user: only the tables an approved fix may touch, nothing else.
-- No CREATE / DROP / ALTER / GRANT, and no access to other tables.
CREATE USER 'harness_write'@'10.0.0.%' IDENTIFIED BY 'change-me-write'
  WITH MAX_USER_CONNECTIONS 2;
GRANT SELECT, INSERT, UPDATE, DELETE ON sik.kamar_inap                  TO 'harness_write'@'10.0.0.%';
GRANT SELECT, UPDATE                 ON sik.kamar                       TO 'harness_write'@'10.0.0.%';
GRANT SELECT, UPDATE                 ON sik.reg_periksa                 TO 'harness_write'@'10.0.0.%';
GRANT SELECT, DELETE                 ON sik.rawat_jl_pr                 TO 'harness_write'@'10.0.0.%';
GRANT SELECT, DELETE                 ON sik.rawat_inap_pr               TO 'harness_write'@'10.0.0.%';
GRANT SELECT, UPDATE                 ON sik.bridging_surat_kontrol_bpjs TO 'harness_write'@'10.0.0.%';
```

Notes:

- The write user needs `SELECT` on each table so the server can capture the before-image and check the row count.
- These grants are a second safety wall. The server also keeps its own allow-list of tables a fix may change. The final list is confirmed in milestone M3; trim it to what you actually need.
- Every table in the write grants must exist. If one is missing in your schema, remove that line.
- Check what a user can do with `SHOW GRANTS FOR 'harness_write'@'10.0.0.%';`
- The harness checks both users at startup: it refuses a read user with any write privilege (including `root`), and a write user with privileges `ON *.*`, `PROXY` or `WITH GRANT OPTION`.
- Optional on MariaDB, as an extra limit on top of the harness's own 10 s query timeout: `ALTER USER 'harness_read'@'10.0.0.%' WITH MAX_STATEMENT_TIME 30;`

### 2. Dump the live schema

Our Khanza schema has local changes, so the harness reads the real schema instead of assuming standard columns.

```bash
pnpm inspect-schema                 # tables the harness uses -> docs/schema.md
pnpm inspect-schema --all           # also list every table in the database
pnpm inspect-schema --tables a,b    # also document extra tables in full
```

The script uses the **read user** and reads only `information_schema` (no patient rows). It prints and writes to `docs/schema.md`:

- missing tables and columns compared to standard Khanza,
- each table's columns (type, enum values, null, key, default, comment),
- indexes and foreign keys,
- with `--all`, every table name with its column count and row estimate.

Then add what the tables *mean* to [docs/khanza_notes.md](docs/khanza_notes.md). The agent reads both files before writing SQL.

After a schema change, also refresh the test fixture so tests use the same table structure (structure only, no rows):

```bash
pnpm dump-test-schema    # -> packages/tools/test/fixtures/khanza-schema.sql
```

### 3. Try the read tools

```bash
pnpm tool                                              # list the tools
pnpm tool cariPasien '{"nama":"budi santoso"}'
pnpm tool kunjunganAktif '{"noRkmMedis":"012345"}'
pnpm tool riwayatKamar '{"noRawat":"2026/01/15/000123"}'
pnpm tool statusKamar '{"namaBangsal":"Mawar"}'
pnpm tool daftarTindakan '{"noRawat":"2026/01/15/000123"}'
pnpm tool statusBilling '{"noRawat":"2026/01/15/000123"}'
pnpm tool dataSep '{"noRawat":"2026/01/15/000123"}'
pnpm tool suratKontrol '{"noSep":"0001R0010126V000123"}'
```

Each run is recorded in the audit log (`data/audit.sqlite`): the tool call with its input and output, and every query with its parameters, row count and duration. Look at it with any SQLite viewer, e.g. `sqlite3 data/audit.sqlite "SELECT tool, status, started_at FROM tool_calls"`.

### 4. Run the server and ask the agent

```bash
pnpm start       # http://127.0.0.1:8787
```

```bash
# Tanya Data (answers stream back as Server-Sent Events)
curl -N -X POST localhost:8787/ask -H 'content-type: application/json' \
  -d '{"question":"Cek riwayat kamar pasien RM 012345"}'

# Ticket: create, then investigate
curl -X POST localhost:8787/tickets -H 'content-type: application/json' \
  -d '{"nurseName":"Ns. Ayu","unit":"Mawar","complaint":"Pasien RM 012345 tidak bisa dipindah ke kamar Mawar"}'
curl -N -X POST localhost:8787/tickets/<id>/investigate
```

Events: `run_started` (run and conversation id, provider, model), `text_delta` (answer text), `tool_started` / `tool_finished` (each check the agent makes, with the full result), then `done` or `error`. Send the `conversationId` from `run_started` with the next `/ask` to ask a follow-up in the same context.

| Endpoint | |
|---|---|
| `GET /health` | Khanza server, read-only status, AI provider and model |
| `POST /tickets` | `{ nurseName, unit, complaint }` |
| `GET /tickets`, `GET /tickets/:id` | list / one ticket |
| `POST /tickets/:id/investigate` | run the agent on a ticket; optional `{ question }` for a follow-up (SSE) |
| `POST /ask` | `{ question, conversationId? }` (SSE) |

Request and event Schemas are in `packages/shared/src/api.ts`.

## AI providers

Switching provider is a `.env` change, no code change:

| Provider | `LLM_PROVIDER` | `LLM_MODEL` | `LLM_BASE_URL` | `LLM_API_KEY` |
|---|---|---|---|---|
| Claude (Anthropic API) | `anthropic` | `claude-opus-5-5` | empty | Anthropic key |
| OpenAI | `openai` | e.g. `gpt-6-sol` | empty | OpenAI key |
| Ollama (local) | `ollama` | e.g. `qwen3` | empty (`http://localhost:11434/v1`) | empty |
| LM Studio (local) | `lmstudio` | model name | empty (`http://localhost:1234/v1`) | empty |
| Any OpenAI-compatible server or gateway | any name, e.g. `vikey` | model id | its `/v1` URL | its key |
| Test without AI | `fake` | empty | | |

Notes:

- For a local model you may set `LLM_MASK_PII=false`; keep it `true` for anything outside the hospital.
- Patient names, RM and visit numbers are sent to the model (it needs them). NIK, phone numbers and addresses are masked.
- The vikey gateway drops tool results when a **Claude** model calls several tools at once (on both its endpoints), so the agent repeats checks or reports missing results. DeepSeek and Gemini through the same gateway work correctly. For Claude, use an Anthropic API key directly.

## Read tools

| Tool | Input | What it returns |
|---|---|---|
| `cariPasien` | `noRkmMedis` or `nama` | RM, name, sex, birth date, age, payer. Never NIK, phone or address. Max 20. |
| `kunjunganAktif` | `noRkmMedis`, `batas?` | Latest visits, newest first, with status, payment status, clinic, doctor, payer, current room and number of active `kamar_inap` rows. |
| `riwayatKamar` | `noRawat` | All `kamar_inap` rows of a stay in order, with ward and class; flags active rows (`stts_pulang = '-'`). |
| `statusKamar` | `kdKamar`, `kdBangsal` or `namaBangsal` | Room status, active patients per room, whether it can be used, and a note when `kamar.status` disagrees with the patients in it. |
| `daftarTindakan` | `noRawat` | Tindakan from `rawat_jl_dr/pr/drpr` and `rawat_inap_dr/pr/drpr`, with names and the source table. |
| `statusBilling` | `noRawat` | `status_bayar`, `stts`, and the `nota_jalan` / `nota_inap` bill if one exists. |
| `dataSep` | `noRawat` | BPJS SEP rows, without patient name, card number or phone. |
| `suratKontrol` | `noSep` | BPJS control letters of a SEP. |

All tools use fixed, parameterized SELECT queries on the read user, with a server-side time limit (`KHANZA_QUERY_TIMEOUT`, default 10 s).

## Development

```bash
pnpm typecheck   # tsc in every workspace
pnpm lint        # oxlint
pnpm test        # vitest (all workspaces)
pnpm knip        # unused files, exports and dependencies
pnpm start       # start the HTTP server (apps/server)
```

### Test database

Database tests never use the real Khanza DB. They create a database named `simrs_harness_test`, load the table structure from `packages/tools/test/fixtures/khanza-schema.sql` and made-up rows from `seed.sql`, and create a read user and a write user with the README grants. The test DB comes from, in order:

1. **Your own server**: set `KHANZA_TEST_DB_HOST`, `KHANZA_TEST_DB_PORT`, `KHANZA_TEST_DB_ADMIN_USER` (default `root`) and `KHANZA_TEST_DB_ADMIN_PASS`. With Docker: `docker compose up -d`, then `KHANZA_TEST_DB_HOST=127.0.0.1 KHANZA_TEST_DB_PORT=3307 KHANZA_TEST_DB_ADMIN_PASS=test pnpm test`.
2. **A temporary MariaDB** started by the tests in a temp folder, if `mariadbd` is installed (`brew install mariadb` on macOS). It is deleted after the run.
3. Otherwise the database tests are skipped with a warning.

TypeScript files run directly with Node 24 (type stripping), so there is no build step for scripts.

## Repo layout

```
apps/
  server/     Effect HTTP server: API, agent loop, approval flow, SSE streaming
  web/        React + TanStack Router UI
  desktop/    Electron shell
packages/
  shared/     Effect Schemas for API contracts, render blocks, ticket/fix types
  tools/      Neutral tool registry + handlers + SQL guards
  llm/        LLM adapter interface + adapters + fake adapter for tests
  mcp/        MCP server exposing packages/tools
scripts/
  inspect-schema.ts     dump the live schema to docs/schema.md
  dump-test-schema.ts   copy table structure into the test fixture
  run-tool.ts           run one read tool from the terminal (pnpm tool)
docs/
  schema.md, khanza_notes.md, PLAN.md
```

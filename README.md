# SIMRS Harness

AI assistant for hospital IT staff working with **SIMRS Khanza**.

- **Tiket mode:** paste a nurse's complaint. The agent reads the real patient data through safe, read-only tools, explains each check, gives a diagnosis and proposes a fix as SQL. The fix only runs after a person clicks **Approve**, and it can be rolled back.
- **Tanya Data mode:** ask questions about hospital data in plain Indonesian ("10 obat paling banyak dipakai minggu ini"). The agent writes a guarded `SELECT` and shows the answer as a table, chart or number.

> Status: **M5 done**: web UI (Tiket, Tanya Data, Pengaturan) with login, on top of the database layer, audit log, read/diagnose/Tanya Data tools, AI agent and fixes with approval and rollback. See [docs/PLAN.md](docs/PLAN.md).

## Safety model (short version)

| Rule | How |
|---|---|
| Read-only by default | Agent tools use a MySQL user with `SELECT` only. The harness checks `SHOW GRANTS` at startup and refuses to run if that user can change data. |
| Writes need approval | The AI can only *propose* a fix. After Approve, the server runs it with a separate write user, in a transaction, and rolls back if the affected row count differs from the preview. |
| Every fix can be undone | The affected rows are saved (before-image) before the change runs. |
| Audit everything | Questions, tool calls, queries, fixes, approvals, rollbacks and the AI model used are logged in a separate SQLite DB, never in Khanza. |
| Patient privacy | NIK, phone numbers and addresses are masked before data goes to an external AI provider. AI-written queries can't return them at all (only filter or count them). |
| AI-written SQL is checked | Tanya Data queries are parsed before they run: one SELECT only, no credential tables, max 500 rows, time limit. |

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
GRANT SELECT, INSERT, DELETE         ON sik.rawat_jl_pr                 TO 'harness_write'@'10.0.0.%';
GRANT SELECT, INSERT, DELETE         ON sik.rawat_inap_pr               TO 'harness_write'@'10.0.0.%';
GRANT SELECT, UPDATE                 ON sik.bridging_surat_kontrol_bpjs TO 'harness_write'@'10.0.0.%';
```

Notes:

- The write user needs `SELECT` on each table so the server can capture the before-image and check the row count.
- Rollback runs the opposite statement, so a table needs the opposite privilege too: undoing a DELETE re-inserts the rows (hence `INSERT` on `rawat_jl_pr` / `rawat_inap_pr`), undoing an INSERT deletes them. A fix itself can still only DELETE from those tables; the server's allow-list (`packages/tools/src/fixes/guard.ts`) decides which statements a fix may use.
- These grants are a second safety wall behind that allow-list. Trim both to what you actually need.
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
pnpm tool lihatSkema '{"kataKunci":"obat"}'
pnpm tool jalankanQueryBaca '{"sql":"SELECT COUNT(*) AS jumlah FROM reg_periksa WHERE tgl_registrasi = CURDATE()","alasan":"coba"}'
```

Each run is recorded in the audit log (`data/audit.sqlite`): the tool call with its input and output, and every query with its parameters, row count and duration. Look at it with any SQLite viewer, e.g. `sqlite3 data/audit.sqlite "SELECT tool, status, started_at FROM tool_calls"`.

### 4. Build the UI and start the server

```bash
pnpm build       # web UI -> apps/web/dist (once, and after updates)
pnpm start       # http://127.0.0.1:8787
```

Open http://127.0.0.1:8787. The first visit asks for the **first admin account**. After that everyone logs in with their own account, which admins create under **Pengaturan → Pengguna**.

- **Tiket.** Paste a nurse's complaint with **+ Tiket baru**. The AI investigates right away. The middle column shows:
  - "Yang dicek AI" (✓ fine, ! problem found, ✕ failed; click a step for its details);
  - the diagnosis;
  - "Saran perbaikan" with the proposed SQL, how many rows it changes, and **Setujui / Edit / Tolak**. After approval it shows the result and **Rollback**.

  The right column shows the patient (identity, current visit, room, DPJP, visit timeline) and the AI's summary. Ask follow-up questions at the bottom.
- **Patient documents.** Under the patient card, **Riwayat**, **CPPT / SOAP** and **Resume** make a printable document straight from Khanza; no AI is involved. You can also ask the agent, e.g. "buatkan CPPT pasien 2026/10/21/000002". Each document has **Cetak / PDF**, open in a new tab, and download HTML.
  - **Riwayat** shows all visits (latest 20) with diagnoses (ICD-10), rooms, tindakan and drugs.
  - **CPPT** shows the SOAP notes from `pemeriksaan_ralan` / `pemeriksaan_ranap`, each with the doctor or nurse who wrote it and the vital signs, plus diagnoses, allergies, lab (abnormal values in red) and radiology.
  - **Resume** shows the resume medis written in Khanza, or a clearly marked draft built from the CPPT, with the empty fields left for the doctor.

  The HTML is filled from a fixed template by the server, never written by the AI, and every value is escaped. It is served with a CSP that allows no scripts. Generated documents are kept in the audit DB, and downloads are logged.
- **Tanya Data.** Ask in plain Indonesian. Answers show tables (sortable, CSV export), charts and numbers, each with an assumption line and "Query yang dipakai". **Simpan ke favorit** saves the question and SQL; favorites re-run without the AI.
- **Pengaturan.** The tabs are:
  - **AI:** provider, model, base URL, API key, "samarkan data" and **Tes koneksi**. Saving switches the AI without a restart and overrides `.env`; admins only.
  - **Audit log:** questions, tool calls, queries, fix approvals, logins, filterable.
  - **Pengguna:** admins only.
  - **Akun:** change your own password.

To serve the hospital network, set `SERVER_HOST=0.0.0.0`. Behind HTTPS (e.g. a reverse proxy), also set `COOKIE_SECURE=true`.

Security notes:

- **Passwords:** scrypt hashes in the audit DB.
- **Sessions:** an HttpOnly, SameSite=Strict cookie (12 hours); only a hash of the token is stored.
- **Wrong passwords:** after 5 wrong tries a username is locked for a minute.
- **API key:** an API key saved on the settings page is stored in `data/audit.sqlite`. Keep that file readable only by the account that runs the server.

### 5. Fixes: approve and roll back

When the agent finds data to fix, it calls `usulkanPerbaikan`. That only **stores a proposal** (status `pending`) with the exact SQL and a preview of the rows it will change. Nothing touches Khanza until someone approves it in the UI. The user who approves is recorded in the audit log.

What the server checks:

- **Proposal.** One UPDATE, INSERT or DELETE on an allow-listed table:

  | Table | Allowed |
  |---|---|
  | `kamar_inap` | UPDATE, INSERT, DELETE |
  | `kamar`, `reg_periksa`, `bridging_surat_kontrol_bpjs` | UPDATE |
  | `rawat_jl_pr`, `rawat_inap_pr` | DELETE |

  - UPDATE and DELETE need a WHERE, and no ORDER BY or LIMIT.
  - Primary-key columns can't be changed.
  - No SQL comments.
  - At most 20 rows.
- **Approve.** The approval is written to the audit log first. Then, in one transaction on the write user, the server:
  1. Locks the rows and checks the count still matches the preview, saving them as the before-image.
  2. Runs the SQL and checks the affected row count.
  3. Saves the after-image.

  Any mismatch rolls everything back and marks the fix `failed` with the reason.
- **Edit.** **Edit** saves a corrected proposal, which is checked again, and rejects the original.
- **Rollback.** The server refuses if the rows changed since the fix ran. Otherwise it restores the before-image in one transaction.

### 6. Desktop app (Windows)

`apps/desktop` wraps the UI in an Electron window and adds **Buka di Khanza**.

**Build the installer** (on any OS; the result is unsigned, so Windows SmartScreen asks once):

```bash
pnpm --filter @simrs/desktop dist:win    # apps/desktop/release/SIMRS-Harness-Setup-<version>.exe
```

**First start.** The app asks which server to use:

- **Server di jaringan RS** (recommended): enter the address of the server from step 4, e.g. `http://10.0.0.5:8787`. Run that server with `SERVER_HOST=0.0.0.0` so other PCs can reach it. All IT PCs then share one audit log.
- **Jalankan server di komputer ini**: the app runs the server itself with its built-in Node, so the PC needs no Node.js. Its settings are in `%APPDATA%\SIMRS Harness\.env` (created from `.env.example` on first start; **Buka file .env** opens the folder). The audit DB is `%APPDATA%\SIMRS Harness\data\audit.sqlite` and the server log is `logs\server.log` next to it. If the server does not start, the reason is shown on the setup page.

Change it later from the menu **Aplikasi → Pengaturan koneksi** or **Pengaturan → Desktop**.

**Buka di Khanza.** Choose the file that starts Khanza on that PC once (usually its `.bat`), in **Pengaturan → Desktop** or the first time you click the button. The button is on the patient card, on documents, and under chat answers that mention a no. rawat or no. RM. It:

1. copies the no. rawat (or no. RM) to the clipboard;
2. brings the open Khanza window to the front (a `java`/`javaw` window titled "Khanza…" or "SIM …"), or starts the `.bat` if Khanza is not open;
3. tells you to paste the number into Khanza's search.

Khanza cannot yet be told to open a specific form; see "Khanza bridge" in `docs/PLAN.md`.

**Develop:** `pnpm --filter @simrs/desktop dev` builds the UI bundle and starts the app. While developing it uses the repo's `.env`. Set `SIMRS_DESKTOP_DATA_DIR` to keep settings and the audit DB in another folder.

### HTTP API

The UI uses the same API. Everything except `/api/health`, `/api/auth/state`, `/api/auth/login` and `/api/auth/setup` needs a login cookie:

```bash
curl -c jar -X POST localhost:8787/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"it-budi","password":"..."}'
curl -b jar -N -X POST localhost:8787/api/ask -H 'content-type: application/json' \
  -d '{"question":"10 obat paling banyak dipakai minggu ini"}'
```

`/api/ask` and `/api/tickets/:id/investigate` stream Server-Sent Events:

- `run_started`: run and conversation id, provider, model;
- `text_delta`: answer text;
- `tool_started` / `tool_finished`: each check, with the full result;
- `render`: a table, chart, number or list, with its SQL;
- then `done` or `error`.

Send the `conversationId` with the next `/api/ask` for a follow-up.

| Endpoint | |
|---|---|
| `GET /api/health` | Khanza server, read-only status, AI provider and model (public) |
| `GET /api/auth/state` | logged-in user, or `setupNeeded` (public) |
| `POST /api/auth/setup` | `{ username, displayName, password }`: first admin, only while there are no users |
| `POST /api/auth/login`, `POST /api/auth/logout` | |
| `POST /api/auth/password` | `{ currentPassword, newPassword }` |
| `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` | manage users (admin) |
| `GET /api/stats` | registrations today, inpatients, open tickets, fixes waiting |
| `POST /api/tickets`, `GET /api/tickets`, `GET /api/tickets/:id` | `{ nurseName, unit, complaint }` |
| `PATCH /api/tickets/:id` | `{ status }`: close or reopen |
| `GET /api/tickets/:id/transcript` | past investigations: steps, answers, blocks, fixes |
| `POST /api/tickets/:id/investigate` | run the agent; optional `{ question }` for a follow-up (SSE) |
| `POST /api/ask` | `{ question, conversationId? }` (SSE) |
| `GET /api/conversations`, `GET /api/conversations/:id` | Tanya Data threads (`?mine=1`) |
| `GET /api/patients/:rm` | patient card (no NIK, phone or address) |
| `GET /api/fixes`, `GET /api/fixes/:id` | `?status=pending&ticketId=` |
| `POST /api/fixes` | `{ title, reason, sql, params?, ticketId?, replaces? }` |
| `POST /api/fixes/:id/approve`, `/reject` (`{ reason? }`), `/rollback` | |
| `POST /api/documents` | `{ jenis: "riwayat" \| "cppt" \| "resume", noRkmMedis?, noRawat? }`: make a patient document |
| `GET /api/documents/:id` | its HTML (`?download=1` to save it) |
| `GET /api/favorites`, `POST /api/favorites` (`{ blockId, question? }`), `DELETE /api/favorites/:id`, `POST /api/favorites/:id/run` | |
| `GET /api/settings/llm`, `PUT /api/settings/llm`, `POST /api/settings/llm/test` | AI provider (changes: admin) |
| `GET /api/audit` | `?kind=runs\|tools\|queries\|fixes\|events&q=&from=&to=&limit=&offset=` |

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
- Patient names, RM and visit numbers are sent to the model (it needs them). NIK, phone numbers and addresses are masked, and so is free-text clinical writing: SOAP notes, radiology reports and resume text. Diagnoses, vital signs and lab values are still sent. With masking off (local model), the AI can also summarise the notes.
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

## Tanya Data tools

The agent answers data questions with three tools:

1. **`lihatSkema(kataKunci)`** finds tables and columns for a topic in three places:
   - `docs/schema.md`;
   - matching lines of `docs/khanza_notes.md`;
   - the live database (`information_schema`), which covers the hundreds of tables not in `schema.md`.

   Personal columns are marked, and login/credential tables are left out.
2. **`jalankanQueryBaca(sql, alasan)`** runs a SELECT the AI wrote. Before it runs, `packages/tools/src/info/select-guard.ts` checks it:
   - **One SELECT only** (WITH and UNION are fine). UPDATE, DELETE, SHOW, CALL, SET, several statements, comments, `INTO OUTFILE`, `FOR UPDATE`, `@variables`, other databases and functions like `SLEEP` or `LOAD_FILE` are rejected.
   - **Personal columns** can be used in WHERE, JOIN, GROUP BY or inside `COUNT()`, but never returned. That covers NIK/KTP, phone numbers, addresses, email, BPJS card numbers, mother's name, passwords and bank accounts. `SELECT *` on a table that has such columns is rejected. In Khanza `nik` is the employee number, so it is allowed.
   - **Credential tables** can't be read at all: `user`, `admin`, `set_akun_*`, `password_*` and similar.
   - **At most 500 rows:** without a LIMIT, `LIMIT 501` is added so a cut result is reported. A larger LIMIT is rejected.
   - **Same limits as the other tools:** it runs on the read user with the same time limit and is logged in the audit log with the question that triggered it.
   - **Errors go back to the AI** so it can fix the query. After 3 failures in a row it stops and explains what it could not answer.
   - **The AI sees the first 50 rows;** the full result is stored for display.
3. **`tampilkan(tipe, judul, queryId, asumsi?, opsi?)`** shows a stored result as `table`, `bar`, `line`, `pie`, `stat` or `list`, with the SQL and a one-line assumption ("bulan ini = 1–22 Okt 2026, hanya rawat jalan"). The brief named this argument `data`; here it is a `queryId`, so the numbers on screen are exactly what the database returned and the AI never retypes them.

Favorites store the question, the SQL and the chart settings, and re-run through the same guard and audit log.

## Development

```bash
pnpm typecheck   # tsc in every workspace
pnpm lint        # oxlint
pnpm test        # vitest (all workspaces)
pnpm knip        # unused files, exports and dependencies
pnpm start       # start the HTTP server (apps/server)
pnpm dev:web     # UI with hot reload on :5173, /api forwarded to :8787 (run pnpm start too)
pnpm build       # build the UI into apps/web/dist
pnpm e2e         # build the UI and run the Playwright smoke tests
```

**End-to-end tests and UI demos.** `node apps/server/test/e2e-server.ts` starts a server on :8799 with:

- the real API;
- the throwaway synthetic test DB;
- a scripted "AI";
- the built UI.

Open it to try the UI without a real AI or real patient data. The scripted AI understands a ticket about "RM 000002" and the questions "… per poli" and "… hari ini". `pnpm e2e` runs Playwright against that server; the first time, install the browser with `pnpm --filter @simrs/web exec playwright install chromium`.

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
  desktop/    Electron app: window, setup page, local server, Buka di Khanza, Windows installer
packages/
  shared/     Effect Schemas for API contracts, render blocks, ticket/fix types
  tools/      Neutral tool registry + handlers + SQL guards
  llm/        LLM adapter interface + adapters + fake adapter for tests
  mcp/        MCP server exposing packages/tools
scripts/
  inspect-schema.ts     dump the live schema to docs/schema.md
  dump-test-schema.ts   copy table structure into the test fixture
  run-tool.ts           run one read or Tanya Data tool from the terminal (pnpm tool)
docs/
  schema.md, khanza_notes.md, PLAN.md
```

# Plan

Status: **M5.1 (patient documents) done, waiting for your test.** Next: routine data checks and the agent test set (M5.2), then M6.

## Packages and main modules

| Package | Main modules |
|---|---|
| `packages/shared` | `contracts/` (API request/response Schemas), `render.ts` (render block Schema: table, bar, line, pie, stat, list), `ticket.ts`, `fix.ts`, `audit.ts`, `sse.ts` (stream event Schema) |
| `packages/tools` | `audit/` (SQLite audit log + migrations, shared by server and MCP), `khanza/` (read and write pools, grants check, query timeout), `registry.ts` (`Tool` = name, description, params Schema, kind, handler), `read/` (cariPasien, kunjunganAktif, riwayatKamar, statusKamar, daftarTindakan, statusBilling, dataSep, suratKontrol), `diagnose/` (diagnosaPindahKamar, diagnosaTindakan), `propose/usulkanPerbaikan.ts`, `info/` (lihatSkema, jalankanQueryBaca, tampilkan), `guards/` (select guard, write guard, column deny-list, PII masking), `services/` (KhanzaRead, KhanzaWrite, AuditLog, FixStore as Effect services) |
| `packages/llm` | `LlmClient.ts` (service: `chat(messages, tools) -> Stream<LlmEvent>`), `adapters/anthropic.ts`, `adapters/openai-compat.ts`, `adapters/fake.ts`, `layer.ts` (picks adapter from `LLM_PROVIDER`) |
| `packages/mcp` | `server.ts` (registers the tool registry with `@modelcontextprotocol/sdk`), `stdio.ts`, `http.ts` |
| `apps/server` | `config.ts`, `agent/` (loop, `system-prompt.md`), `fixes/` (approve, execute, rollback), `auth/` (local login), `http/` (routes, SSE), `main.ts` |
| `apps/web` | routes `tiket`, `tanya`, `pengaturan`; `components/` (render blocks: table, chart, stat), stores |
| `apps/desktop` | Electron main (starts or connects to the server), preload, packaging for Windows |

## Milestones

Each one ends with tests passing and a stop for you to test.

- **M1. Data layer. ✅ Done.** Config Layer, read and write pools, SQLite audit DB with migrations, the 8 read tools, `pnpm tool` to try them, tests on synthetic data (temporary MariaDB or `docker-compose.yml`).
- **M2. Agent. ✅ Done.** Tool registry, LLM service with `anthropic`, `openai-compat` and `fake` adapters, agent loop, `POST /ask` and `POST /tickets/:id/investigate` with SSE, PII masking. Demo with DeepSeek and Gemini (and Claude through a gateway).
- **M3. Fixes. ✅ Done.** `diagnosaPindahKamar`, `diagnosaTindakan`, `usulkanPerbaikan` → preview → approve → execute in a transaction → rollback. Tests prove a row-count mismatch rolls back and nothing is written without an approval row in the audit log.
- **M4. Tanya Data tools. ✅ Done.** `lihatSkema`, guarded `jalankanQueryBaca`, `tampilkan`. Tests prove non-SELECT, multiple statements and deny-listed columns are rejected.
- **M5. Web UI. ✅ Done.** Tiket, Tanya Data (charts, tables, favorites), Pengaturan (provider, audit log). Login. Playwright smoke tests.
- **M5.1. Patient documents. ✅ Done.** Riwayat pasien, CPPT / SOAP and resume medis as printable HTML from Khanza data (`dokumenPasien`), from the patient card or the agent.
- **M5.2. Routine data checks and agent test set.** Scheduled checks for known data problems with "Buat tiket"; fixed scenarios with known answers to score each AI provider/model.
- **M6. Desktop. ✅ Done.** Electron app wrapping the UI (remote server or a local server it starts), setup page, "Buka di Khanza", Windows installer.
- **M6.1. Khanza bridge.** A small patch to Khanza so the desktop app can open a given form for a given no. rawat (see M6 notes).
- **M7. MCP.** Same tools over stdio and streamable HTTP, README section for Claude Desktop / Claude Code.

## M1 notes

- The DB pools and audit log live in `packages/tools` (not `apps/server`) so the MCP server (M7) uses the same guards and the same audit log.
- `daftarTindakan` also reads `rawat_jl_dr`, `rawat_jl_drpr`, `rawat_inap_dr` and `rawat_inap_drpr`. The brief listed only the `_pr` tables, but most tindakan in our data are in the `_drpr` tables. Their columns were checked with `inspect-schema` first.
- The read layer refuses to start if the read user can write (checked with `SHOW GRANTS`). The write layer refuses a user with global privileges, PROXY or GRANT OPTION.
- Dates and times are returned as stored strings (`"2026-10-21"`, `"0000-00-00"`) to avoid time-zone shifts.
- `cariPasien`, `dataSep` and the other tools never select NIK, phone numbers or addresses, so there is nothing to mask in their output. General PII masking for AI-written queries comes in M2/M4.

## M2 notes

- Tickets, conversations and agent runs live in the audit SQLite DB (migration `0002_agent`). Each run records the question, provider, model, masking setting, steps, tokens and result; `tool_calls.session_id` is the run id.
- The system prompt is `apps/server/src/agent/system-prompt.md` followed by `docs/khanza_notes.md`, so local notes reach the model without code changes.
- The model gets the server date and time with every question, so "hari ini" and "minggu ini" resolve correctly.
- Claude's own response content (including thinking blocks) is replayed unchanged on the next step. All tool results of a turn go back in one message.
- No login yet (M5); the server listens on 127.0.0.1 by default.

## M3 notes

- A fix goes through these statuses: `pending` → `approved` → `applied` → `rolled_back`, with `failed` and `rejected` as other endings. Fixes and their events (who did what, when) live in the audit DB (migration `0003_fixes`). Each write query in the audit log carries its `fix_id`.
- **Proposal.** The AI (or an IT person through `POST /fixes`) gives one UPDATE, INSERT or DELETE with `?` params. The guard (`packages/tools/src/fixes/guard.ts`) checks the statement:
  - Exactly one statement on one allow-listed table. SQL comments are rejected.
  - UPDATE and DELETE need a WHERE and may not use ORDER BY or LIMIT.
  - UPDATE may not change primary-key columns.
  - INSERT needs explicit columns and literal key values.

  The params are inlined (escaped by mysql2), so the stored SQL is exactly what a person reviews and what runs.
- **Preview.** The server runs a SELECT with the same WHERE on the read user, stores the matching rows and their count, and refuses more than 20 rows.
- **Approve.** The `approved` event is committed in SQLite before Khanza is touched. Approval can only move a fix from `pending`, so two people clicking at once can't apply it twice. The executor refuses to run a fix with no approval event.
- **Execute.** One transaction on the write user:
  1. Re-check the statement.
  2. Lock the target rows (`SELECT ... FOR UPDATE`) and require the same count as the preview. This saves the before-image.
  3. Run the statement and require the affected count to match.
  4. Read the after-image.

  Any mismatch rolls the transaction back and the fix becomes `failed` with the reason.
- **Rollback.** First check that the rows still equal the after-image; if someone changed them since, the rollback is refused. Then undo in one transaction:
  - UPDATE: restore the changed columns.
  - DELETE: re-insert the before rows.
  - INSERT: delete by key.

  Every step must affect exactly 1 row, or the whole rollback is undone and logged as `rollback_failed`.
- `@effect/sql-mysql2` forces `multipleStatements: true` on its pool. We don't rely on the driver: every fix statement goes through the guard, which allows one statement and no comments.
- Rollback needs the opposite privilege. The write user now also has `INSERT` on `rawat_jl_pr` and `rawat_inap_pr`, so a deleted tindakan can be restored. Fixes on those tables are still DELETE only.
- There's no login yet, so who approves comes from the `actor` field in the request body. M5 replaces it with the logged-in user.

## M4 notes

- **Guard** (`packages/tools/src/info/select-guard.ts`). It walks the whole parsed query, so personal columns are caught in subqueries, derived tables, CTEs and UNION parts too. `MAX()`, `GROUP_CONCAT()` and `CONCAT()` would return the raw value, so only `COUNT()` may wrap a personal column. The brief said "aggregates"; we narrowed that to COUNT.
- **Deny-list from our real schema** (`info/sensitive.ts`). It was built from the column names in `sik` (metadata only) and matches by name, so it also covers tables not in `docs/schema.md`. `nik` stays allowed because in Khanza it is the employee number. Credential tables (`user`, `admin`, `set_akun_*`, `password_*`, `mlite_users`, ...) can't be read and are hidden from `lihatSkema`.
- **Masking.** `maskPii` now also masks every column the guard protects, by name, as a second layer.
- **Stored results.** Results (max 500 rows), render blocks and favorites live in the audit DB (migration `0004_tanya_data`). `tampilkan` takes a `queryId` instead of data, so charts can't show numbers the AI made up.
- **What the AI sees.** Tools can define `forModel` to send the AI less than the UI gets: 50 of 500 rows for queries, a short confirmation for `tampilkan`.
- **Parser quirk.** node-sql-parser is stricter than MariaDB about a few words used as aliases (`AS status`). The error tells the model to use backticks or another alias, and the model fixes it on its own.
- **Codes in `khanza_notes.md`.** Filled in from our reference tables: poli gigi `U0010`, BPJS `BPJ`, umum `A09`, Melati `kls21`–`kls25`, Mawar `MW` (inactive).
- **Local `sik` copy.** It ends on 14 Jan 2026, so "hari ini" questions return 0 there.
- **Live check** with DeepSeek through vikey, on the synthetic test DB. "Berapa pasien yang daftar hari ini?" gave a stat; "Jumlah kunjungan per poli bulan ini" and "10 tindakan paling sering di poli gigi bulan ini" gave bar charts. All numbers matched the data, with assumption lines.

## M5 notes

- **Login.** Users, sessions and an event log are in the audit DB (migration `0005_auth`). The first visit creates the first admin; admins add more users. Every API route except health, login and first-run setup needs a session. The user is now who approves fixes, asks questions (`agent_runs.asked_by`) and creates tickets, so the `actor` / `createdBy` request fields are gone.
- **API under `/api`.** The server serves the built UI at every other path, with security headers (CSP `default-src 'self'`, no framing). Fonts are bundled, so nothing loads from the internet.
- **AI settings page.** It changes the provider without a restart. `LlmClient` is now a proxy over the current adapter. A broken AI configuration no longer stops the server; questions fail with the reason until an admin fixes it.
- **History.** Ticket and chat history are rebuilt from the audit DB (`agent_runs`, `tool_calls`, `render_blocks`, `fixes`), so a reload shows the same steps, charts and fixes as the live stream.
- **New read tool `kartuPasien`:** identity, the latest visits and DPJP, for the patient column. The AI can use it too, for "ringkas kunjungan pasien ini".
- **UI stack.** React 19, Vite 8, TanStack Router, Tailwind v4, Base UI, ECharts (loaded on first chart), TanStack Table v9, Zustand. `@effect/atom-react` is not used: the UI only reads JSON from the API, so plain stores were enough.
- **Tests.**
  - Vitest unit tests for the UI helpers: SSE parsing, CSV, answer sections, step marks, chart options.
  - Server tests for login, roles, settings, transcripts, the audit API and static files.
  - 7 Playwright smoke tests. They cover setup, ticket → approve → rollback, Tanya Data chart + favorite, stat card, settings + audit log, a 400 px window, and logout.
- **Bugs the tests caught.**
  - "Percakapan baru" reopened the old thread from the URL.
  - The narrow layout scrolled sideways.
  - The answer splitter swallowed the first "-" of a list.

## M5.1 notes

- **Sources.** All checked against our schema first:
  - SOAP: `pemeriksaan_ralan` / `pemeriksaan_ranap`. S = `keluhan`, O = `pemeriksaan` + vital signs, A = `penilaian`, P = `rtl`, plus `instruksi` and `evaluasi`.
  - The writer is `nip`: a `petugas` in ~95% of our recent rows, otherwise a `dokter`.
  - Diagnoses: `diagnosa_pasien` + `penyakit`. Lab: `detail_periksa_lab` + `template_laboratorium`. Radiology: `hasil_radiologi`. Resume: `resume_pasien` / `resume_pasien_ranap`.
  - Header: Khanza `setting` (hospital name, address, logo).

  These 13 tables were added to `docs/schema.md` and the test fixture, with synthetic seed rows.
- **The AI never writes document content.** The server fills a fixed template, and the AI only asks for the document and may add a labelled summary in the chat. Every value is escaped (tested with `<script>` in a SOAP note). Documents are served with `default-src 'none'`, previewed in a sandboxed frame, stored in the audit DB (migration `0006_documents`), and downloads are logged.
- **Privacy.** When masking is on (any external AI), free-text clinical fields are replaced with "[catatan klinis tidak dikirim ke AI]" before anything is sent. Diagnoses, vitals and lab numbers still go.
- **No resume in Khanza.** The resume becomes a draft from the first CPPT entry, the diagnoses, tindakan and drugs. It is clearly marked, with empty fields left for the doctor.

## M6 notes

- **Two modes.** *Remote*: the window loads a harness server on the hospital network (recommended: one audit log). *Local*: the app runs the bundled server (`build/server/main.mjs`, one esbuild file, no `node_modules`) with Electron's Node (`ELECTRON_RUN_AS_NODE`); config in `%APPDATA%\SIMRS Harness\.env`, audit DB and log in the same folder. The server needs no native modules (SQLite is `node:sqlite`).
- **Bridge.** The UI gets `window.simrsDesktop` from the preload: `info`, `openKhanza(copy)`, `chooseKhanzaLauncher`, `openSetup`. The main process only answers the window it created, and only for the harness origin or the setup page; setup functions are refused for the UI. Only strings up to 64 characters go to the clipboard. Links to other sites open in the normal browser.
- **Buka di Khanza.** On Windows it first looks for a running Khanza window (PowerShell: a `java`/`javaw` process whose title matches `Khanza|^SIM `) and brings it to the front, so Khanza is not opened twice. Otherwise it runs the chosen `.bat`/`.cmd`/`.exe`/`.jar` from its own folder. Not yet tried on a hospital PC: check the window-title match against your Khanza build.
- **Khanza bridge (M6.1, planned).** Khanza forms already accept a visit: `RMDataResumePasienRanap.setNoRm(no_rawat, date)`, and `DlgKamarInap` opens forms this way (749 `setNoRm(` calls). The patch: one new class that, after login, listens on `127.0.0.1` with a token for `{form, noRawat}`, opens only forms on a fixed list on the Swing thread (`isCek()` keeps Khanza's own access rights), and brings them to the front; plus one line in the login handler. It needs a Khanza build we maintain (re-apply after each Khanza update) and testing on a hospital PC.
- **Khanza output.** "Buka di Khanza" starts Khanza detached (it outlives the app) with stdout/stderr in `logs/khanza.log`; an exit within 15 s is reported to the UI ("Khanza berhenti… Lihat output").
- **Terminal panel.** The window is a `BaseWindow` with two `WebContentsView`s: the app view and the terminal panel (Ctrl+`, resizable). The panel is a local page (`build/terminal/`, xterm.js) with its own preload; shells are `node-pty` 1.1.0 (prebuilt for macOS and Windows, copied to `build/node_modules` and unpacked from the asar). The web UI can only toggle the panel or open the Khanza output tab; only the panel page may create, write to or resize a shell. At most 8 tabs.
- **Not done yet.** Code signing (SmartScreen warns on first install), auto-update, and the Khanza bridge.

## Decisions and questions

1. **MySQL or MariaDB?** Khanza often runs on MariaDB. `MAX_EXECUTION_TIME` only exists in MySQL; MariaDB uses `SET STATEMENT max_statement_time=10 FOR SELECT ...`. The plan is to detect the server at startup and use the right one, plus an Effect timeout as a backstop. The `inspect-schema` output shows which one you run.
2. **Write allow-list.** Proposed: `kamar_inap`, `kamar`, `reg_periksa`, `rawat_jl_pr`, `rawat_inap_pr`, `bridging_surat_kontrol_bpjs`. Add or remove tables?
3. **Test database.** Tests use synthetic data only, never a copy of real patient data. Docker is the default; tests can also point at any local MariaDB through an env var.
4. **Effect 4.** Effect is now v4 (`effect@4.0.5`): SQL, HTTP and platform modules moved into `effect` itself. The code targets v4.
5. **Extra tables.** Besides the brief's list, `inspect-schema` also checks `penjab` (BPJS vs umum), `resep_obat` / `resep_dokter` (prescriptions) and `dpjp_ranap` (DPJP for the patient card).

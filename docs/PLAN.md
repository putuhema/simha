# Plan

Status: **M6.9 (AI usage & cost) done, waiting for your test.** Next: M7 (MCP over stdio/HTTP) and M5.2 (routine checks and the agent test set).

## Packages and main modules

| Package | Main modules |
|---|---|
| `packages/shared` | `api.ts` (API request/response and stream event Schemas, agent modes, render blocks, fixes), `permissions.ts` (Khanza right → Simha capability, fix table rights), `forms.ts` (resume form draft) |
| `packages/tools` | `audit/` (SQLite audit log + migrations, shared by server and MCP), `khanza/` (read and write pools, grants check, query timeout), `registry.ts` (`Tool` = name, description, params Schema, kind, handler), `read/` (cariPasien, kunjunganAktif, riwayatKamar, statusKamar, daftarTindakan, statusBilling, dataSep, suratKontrol), `diagnose/` (diagnosaPindahKamar, diagnosaTindakan), `propose/usulkanPerbaikan.ts`, `info/` (lihatSkema, jalankanQueryBaca, tampilkan), `app/` (cariAplikasiKhanza, detailAplikasi + generated map), `knowledge/` (examples/notes, search, catatPengetahuan), `guards/` (select guard, write guard, column deny-list, PII masking), `services/` (KhanzaRead, KhanzaWrite, AuditLog, FixStore as Effect services) |
| `packages/llm` | `LlmClient.ts` (service: `chat(messages, tools) -> Stream<LlmEvent>`), `adapters/anthropic.ts`, `adapters/openai-compat.ts`, `adapters/fake.ts`, `layer.ts` (picks adapter from `LLM_PROVIDER`) |
| `packages/mcp` | `server.ts` (registers the tool registry with `@modelcontextprotocol/sdk`), `stdio.ts`, `http.ts` |
| `apps/server` | `config.ts`, `agent/` (loop, `system-prompt.md`, per-user tool filtering), `fixes/` (approve, execute, rollback), `auth/` (SIMRS login + rights refresh), `http/` (routes, SSE), `main.ts` |
| `apps/web` | routes `tanya`, `pengetahuan`, `pengaturan`; Tanya Data and investigate modes; `components/` (render blocks: table, chart, stat; patient card, fix card), stores |
| `apps/desktop` | Electron main (starts or connects to the server), preload, packaging for Windows |

## Milestones

Each one ends with tests passing and a stop for you to test.

- **M1. Data layer. ✅ Done.** Config Layer, read and write pools, SQLite audit DB with migrations, the 8 read tools, `pnpm tool` to try them, tests on synthetic data (temporary MariaDB or `docker-compose.yml`).
- **M2. Agent. ✅ Done.** Tool registry, LLM service with `anthropic`, `openai-compat` and `fake` adapters, agent loop, `POST /ask` (Tanya Data and investigate modes) with SSE, PII masking. Demo with DeepSeek and Gemini (and Claude through a gateway).
- **M3. Fixes. ✅ Done.** `diagnosaPindahKamar`, `diagnosaTindakan`, `usulkanPerbaikan` → preview → approve → execute in a transaction → rollback. Tests prove a row-count mismatch rolls back and nothing is written without an approval row in the audit log.
- **M4. Tanya Data tools. ✅ Done.** `lihatSkema`, guarded `jalankanQueryBaca`, `tampilkan`. Tests prove non-SELECT, multiple statements and deny-listed columns are rejected.
- **M5. Web UI. ✅ Done.** Tanya Data (charts, tables, favorites), Pengaturan (provider, audit log). Login. Playwright smoke tests. Tiket later became the **Investigasi** mode inside the chat (one composer, one thread list, fix cards inline, patient card in a dialog); old ticket threads are migrated to chat threads.
- **M5.1. Patient documents. ✅ Done.** Riwayat pasien, CPPT / SOAP and resume medis as printable HTML from Khanza data (`dokumenPasien`), from the patient card or the agent.
- **M5.2. Routine data checks and agent test set.** Scheduled checks for known data problems that open an investigation; fixed scenarios with known answers to score each AI provider/model.
- **M6. Desktop. ✅ Done.** Electron app wrapping the UI (remote server or a local server it starts), setup page, "Buka di Khanza", Windows installer.
- **M6.2. Resume drafts. ✅ Done.** The AI drafts the resume medis rawat inap from Khanza data, asks for the rest, and "Isi di Khanza" fills Khanza's own form (see M6.2 notes).
- **M6.5. App map: menu, flows, rights. ✅ Done.** `pnpm extract-khanza-app` reads `frmUtama.java` and writes `docs/khanza-app/` (explicit: 20 groups [A]–[T], every button, form, access right and table). Hand-written flows cover registrasi, rawat inap, IGD, lab, radiologi, farmasi, kasir, BPJS, master data and reports. The agent uses `cariAplikasiKhanza` to find a hit and `detailAplikasi` for its full record; `synonyms.json` maps staff words ("pindah kamar", "SEP") to real menu paths.
- **M6.6. AI learning (knowledge). ✅ Done.** Successful answers become unverified examples; 👍 verifies them, 👎 disables them and saves a correction note. `catatPengetahuan` lets the AI save durable hospital facts; the agent retrieves at most five matching examples/notes and injects them into the current user turn. **Pengetahuan AI** page for review, and authenticated knowledge/feedback endpoints. Patient/visit numbers are refused.
- **M6.7. SIMRS login and rights. ✅ Done.** Simha no longer has local passwords or user management: `POST /api/auth/login` runs Khanza's own `AES_ENCRYPT` comparison against `admin`/`user`, syncs a local identity row, and shows the rights in **Pengaturan → Akun**. **Muat ulang hak** re-reads them. CPPT, resume, radiology, digital files and fix approvals follow the same Khanza right as the menu that owns them — server-side 403, hidden/disabled UI, and the AI only receives tools it may use. See M6.7 notes.
- **M6.8. Identity and access questions. ✅ Done.** Every agent turn carries the logged-in account (username, display name, employee/doctor/petugas name, granted rights). `aksesSaya` answers "siapa saya", "nama dokter/perawat saya", "apa hak saya", and "bisa buka menu/form X / punya hak Y" against the generated desktop app map, naming the exact Khanza right when denied. **Pengaturan → Akun** shows the same names, mapped features, workflow tables and the full granted-rights list. See M6.8 notes.
- **M6.9. AI usage & cost. ✅ Done.** `apps/server/src/usage.ts` aggregates `agent_runs` for **Pengaturan → Pemakaian AI** (admin): runs/tokens/cost per day, cache hit rate, failures by provider, slowest questions, per-user usage and a per-run CSV export. Prices are editable per model (USD per 1M input/output/cached/cache-write, optional USD→IDR) and stored in the audit DB; a built-in table covers common models. The OpenAI-compatible adapter now sets `stream_options.include_usage`, which was why the audit log's token columns were empty. See M6.9 notes.
- **M6.1. Khanza bridge. ✅ Done.** `HarnessBridge.java` in the hospital's Khanza build (applied with `integrations/khanza-bridge/apply.mjs`): "Buka di Khanza" opens resume, CPPT/SOAP or riwayat for the visit in the running Khanza (see M6.1 notes).
- **M7. MCP.** Same tools over stdio and streamable HTTP, README section for Claude Desktop / Claude Code.

## M1 notes

- The DB pools and audit log live in `packages/tools` (not `apps/server`) so the MCP server (M7) uses the same guards and the same audit log.
- `daftarTindakan` also reads `rawat_jl_dr`, `rawat_jl_drpr`, `rawat_inap_dr` and `rawat_inap_drpr`. The brief listed only the `_pr` tables, but most tindakan in our data are in the `_drpr` tables. Their columns were checked with `inspect-schema` first.
- The read layer refuses to start if the read user can write (checked with `SHOW GRANTS`). The write layer refuses a user with global privileges, PROXY or GRANT OPTION.
- Dates and times are returned as stored strings (`"2026-10-21"`, `"0000-00-00"`) to avoid time-zone shifts.
- `cariPasien`, `dataSep` and the other tools never select NIK, phone numbers or addresses, so there is nothing to mask in their output. General PII masking for AI-written queries comes in M2/M4.

## M2 notes

- Conversations and agent runs live in the audit SQLite DB (migration `0002_agent`). Each run records the question, provider, model, masking setting, steps, tokens and result; `tool_calls.session_id` is the run id.
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

- **Login.** Users, sessions and an event log are in the audit DB (migration `0005_auth`). The first visit creates the first admin; admins add more users. Every API route except health, login and first-run setup needs a session. The user is now who approves fixes and asks questions (`agent_runs.asked_by`), so the `actor` / `createdBy` request fields are gone. *(Local accounts were replaced by SIMRS login in M6.7; the sessions table and audit fields stay.)*
- **API under `/api`.** The server serves the built UI at every other path, with security headers (CSP `default-src 'self'`, no framing). Fonts are bundled, so nothing loads from the internet.
- **AI settings page.** It changes the provider without a restart. `LlmClient` is now a proxy over the current adapter. A broken AI configuration no longer stops the server; questions fail with the reason until an admin fixes it.
- **History.** Chat and investigation history are rebuilt from the audit DB (`agent_runs`, `tool_calls`, `render_blocks`, `fixes`), so a reload shows the same steps, charts and fixes as the live stream.
- **New read tool `kartuPasien`:** identity, the latest visits and DPJP, for the patient column. The AI can use it too, for "ringkas kunjungan pasien ini".
- **UI stack.** React 19, Vite 8, TanStack Router, Tailwind v4, Base UI, ECharts (loaded on first chart), TanStack Table v9, Zustand. `@effect/atom-react` is not used: the UI only reads JSON from the API, so plain stores were enough.
- **Tests.**
  - Vitest unit tests for the UI helpers: SSE parsing, CSV, answer sections, step marks, chart options.
  - Server tests for login, roles, settings, transcripts, the audit API and static files.
  - 17 Playwright smoke tests. They cover setup, investigate → approve → rollback, Tanya Data chart + favorite, the patient card (CPPT, radiology), settings + audit log, a 400 px window, and logout.
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

- **Two modes.** *Remote*: the window loads a Simha server on the hospital network (recommended: one audit log). *Local*: the app runs the bundled server (`build/server/main.mjs`, one esbuild file, no `node_modules`) with Electron's Node (`ELECTRON_RUN_AS_NODE`); config in `%APPDATA%\Simha\.env`, audit DB and log in the same folder. The server needs no native modules (SQLite is `node:sqlite`).
- **Bridge.** The UI gets `window.simhaDesktop` from the preload: `info`, `openKhanza(copy)`, `chooseKhanzaLauncher`, `openSetup`. The main process only answers the window it created, and only for the Simha origin or the setup page; setup functions are refused for the UI. Only strings up to 64 characters go to the clipboard. Links to other sites open in the normal browser.
- **Buka di Khanza.** On Windows it first looks for a running Khanza window (PowerShell: a `java`/`javaw` process whose title matches `Khanza|^SIM `) and brings it to the front, so Khanza is not opened twice. Otherwise it runs the chosen `.bat`/`.cmd`/`.exe`/`.jar` from its own folder. Not yet tried on a hospital PC: check the window-title match against your Khanza build.
- **Khanza bridge (M6.1, planned).** Khanza forms already accept a visit: `RMDataResumePasienRanap.setNoRm(no_rawat, date)`, and `DlgKamarInap` opens forms this way (749 `setNoRm(` calls). The patch: one new class that, after login, listens on `127.0.0.1` with a token for `{form, noRawat}`, opens only forms on a fixed list on the Swing thread (`isCek()` keeps Khanza's own access rights), and brings them to the front; plus one line in the login handler. It needs a Khanza build we maintain (re-apply after each Khanza update) and testing on a hospital PC.
- **Khanza output.** "Buka di Khanza" starts Khanza detached (it outlives the app) with stdout/stderr in `logs/khanza.log`; an exit within 15 s is reported to the UI ("Khanza berhenti… Lihat output").
- **Terminal panel.** The window is a `BaseWindow` with two `WebContentsView`s: the app view and the terminal panel (Ctrl+`, resizable). The panel is a local page (`build/terminal/`, xterm.js) with its own preload; shells are `node-pty` 1.1.0 (prebuilt for macOS and Windows, copied to `build/node_modules` and unpacked from the asar). The web UI can only toggle the panel or open the Khanza output tab; only the panel page may create, write to or resize a shell. At most 8 tabs.
- **Not done yet.** Code signing (SmartScreen warns on first install) and auto-update.

## M6.1 notes

- **Khanza side** (`integrations/khanza-bridge/HarnessBridge.java`, package `simrskhanza`; the fork's branch `harness-bridge`). Started right after `akses.setData(...)` in `frmUtama.BtnLoginActionPerformed` (only when the login succeeded), stopped at logout. Listens on `127.0.0.1`, random port; writes `port`, a 48-hex-char token and the user to `~/.simha/khanza-bridge.properties` (`rw-------`). One request per connection, one tab-separated line: `TOKEN ping` or `TOKEN open FORM VALUE`; the token is compared in constant time.
- **Forms**, opened the way Khanza's own lists open them (`DlgKamarInap`, `DlgReg`, `frmUtama`): `resume_ranap` (RMDataResumePasienRanap: isCek, setNoRm, tampil), `resume_ralan` (RMDataResumePasien), `soap_ranap` (DlgRawatInap, depo chosen like DlgKamarInap), `soap_ralan` (DlgRawatJalan with the visit's poli and penjamin), `riwayat` (RMRiwayatPerawatan, by no. RM). `resume` and `soap` pick ranap or ralan from `reg_periksa.status_lanjut`. Rights: `data_resume_pasien`, `tindakan_ranap`, `tindakan_ralan` (same as the menu buttons).
- **Order.** Checks (rights, visit exists) run on the Swing thread and are answered right away; the form then opens like a menu click, including Khanza's own warnings (e.g. "User login bukan dokter"), which no longer block the answer.
- **Tested** against the real Khanza code and the local `sik` database (stand-in login): all five forms open on the requested visit; wrong token, unknown form, missing right and unknown visit are refused with a message; the info file is removed at logout. Not yet tested: a real login in the built Khanza, and on a Windows PC.
- **Later:** billing ranap/ralan and SEP (Khanza runs extra prompts and depot logic before opening them).

## M6.5 notes: app map

- **Generated, not guessed.** `scripts/extract-khanza-app.ts` parses `frmUtama.java` (`isCombo()` per `cmbMenu` group, `Panelmenu.add`, `*ActionPerformed`) and each form's SQL strings, filtered by the 1,026 table names in `sik.sql`. Output: `docs/khanza-app/index.json` + `menu/`, `forms/`, README. `--check` fails when the source commit or menu count changed.
- **Hand-written:** `flows/*.md` (narrative + steps), `roles.md` (rights model), `bridge.md` (desktop ↔ Simha), `cara-pakai.md` (group A–T, path and dialog naming), `synonyms.json`. `group-names.json` is an input for short group names. The generator never overwrites these.
- **In-form buttons:** each form's `btn*.setText` labels ("Simpan", "Pindah", "Pulang") are in `index.json` (`forms[].actions`) and in `forms/*.md`, so the agent can say which button to click inside the dialog, not just which menu.
- **Dialog titles:** the generator reads the `internalFrame1` border / `setTitle`, ignores NetBeans' `::[ About Program ]::` placeholder, and falls back to the menu label when the caller sets the title later (`DlgBerkasRawat` → "Berkas Digital Perawatan").
- **Coverage:** 1,094 menu buttons, 1,090 resolve to a form; the 3 INACBG buttons open the PHP panel and `btnfee_rujukan_ranap` is a TODO stub. 1,079 forms, 1,072 rights; 1,052 rights gate exactly one button. Every form also carries the tables it writes/reads (static SQL hints), which is how "form apa yang mengisi kamar_inap" is answered.
- **Tool:** `cariAplikasiKhanza` searches the map offline (no DB, no Khanza pool) and returns menu path, form, rights, tables and flow steps. A table question gets `tabel[]` (forms that write/read it) and `bagian: "tabel"` finds forms by table; `form[].tulis`/`baca` are capped so a 200-table registration form does not flood the model. `AppDocs` loads at startup, like `SchemaDocs`.
- **Prompt:** the system prompt tells the agent to call it for "di menu mana", flow, form and access-right questions, and never to invent a menu. `docs/khanza_notes.md` carries a short pointer so the rule survives prompt caching.
- **Drill-down (`detailAplikasi`):** search returns the door, not the room. A flow answer used to be rebuilt from step titles (the 8-step cap never bit, the prose was never sent), so the four `Pindah` modes, the rights and the warnings were guessed. `detailAplikasi` returns one full record: a flow's intro and every step's `Does` / `Who` / `Hak akses` / `Tabel`; a form's buttons, right-click entries, rights and tables; a menu or a right with what it opens. The two giant dialogs (216 and 277 popups, 177 written tables) made the first version a ~100 KB tool result, so action/table lists stop at 30/40 with a `+N` marker and `cari` filters them by the task's word ("resep pulang" → 1 entry). In memory, no DB. `app/paths.ts` now words the paths for both tools.
- **Honest staleness:** `cariAplikasiKhanza` returns `peta { termuat, commit, dibuat, jumlah }` and never says "menu tidak ada" when index.json failed to load; `detailAplikasi` fails with that message instead of answering. `appMapStatus` is the single check.
- **Freshness gate:** `pnpm check:app-map` compares `index.json` (commit + its own group/button/form counts) with the Khanza git HEAD; it skips when the source is absent. The map test also fails when `docs.source.commit` differs from `~/work/simrsmt` (or `KHANZA_SRC_DIR`), and every flow step must carry a `Does`. `pnpm verify` runs typecheck, lint, tests and the check.

## M6.6 notes: AI learning

- **Schema** (`packages/tools/src/knowledge/KnowledgeStore.ts`, table `knowledge`, migration `0008_knowledge`): `kind` (`example` / `note`), `source` (`auto`, `feedback`, `ai`, `staff`), `text` (question for an example, note text otherwise), `sql`, `render_type`, `title`, `verified`, `active`, `block_id`, `run_id`, `created_by`, `uses`, `last_used_at`.
- **Search** (`knowledge/search.ts`): no FTS5; lower-case tokens, Indonesian stopwords, a light `-an/-kan/-nya` suffix and `me-/ber-/ter-/di-/ke-/se-` prefix stemmer, IDF-weighted cosine overlap. Verified ×1.25; staff/feedback ×1.1, AI ×0.95, automatic ×0.9. Notes need 0.25, examples 0.35.
- **Retrieval**: before each turn, up to 5 active items are added to the **current user message** as `[Pengetahuan dari pertanyaan sebelumnya]` (max 1,600 chars). The block is stored as the turn's `modelText` (the visible/stored question stays plain), so a follow-up replays the exact prompt and the provider cache keeps its prefix; the history budget in `history.ts` bounds the growth.
- **Feedback**: under result blocks by `blockId`; under text-only answers (app-map, documents, summaries) by `runId`. A run-level 👍 stores the question + answer as a verified note; a run-level 👎 stores the correction. The UI shows one set of thumbs per turn (block feedback when a block exists, otherwise answer feedback).
- **Learning sources**:
  - auto: first self-contained answer with a block (not a follow-up), unverified, tied to `block_id`/`run_id`;
  - 👍: verifies the example (creates one from the block if missing) and changes its source to `feedback`;
  - 👎: deactivates the example and, with a comment, saves a note; no approval needed;
  - `catatPengetahuan`: AI note, active immediately but unverified; admin review on the page.
- **Privacy**: `personalReason()` refuses no_rawat, RM/NIK/SEP/phone numbers and emails in notes, examples, feedback and auto-saves. Knowledge never changes Khanza.
- **UI**: thumbs under every render block; the **Pengetahuan AI** tab in **Pengaturan** (`/pengaturan?tab=pengetahuan`; `/pengetahuan` redirects) lists/filters/searches, adds staff notes, and lets admins verify, edit, deactivate or delete.
- **Tests**: store/search/tool unit tests and server end-to-end tests cover auto-save, 👍/👎, moderation, privacy rejection, prompt injection and `catatPengetahuan`.

## Caching, streaming and token budget notes

- **Cache-stable prompt**: tools, system prompt and history are unchanged between turns; the knowledge block travels in the user turn's `modelText`, which is stored and replayed verbatim. Claude keeps the top-level `cache_control`; `LLM_PROVIDER=openai` sends `prompt_cache_key` (the conversation id). DeepSeek and other compatible servers cache the prefix automatically.
- **Telemetry**: `Usage` carries `cachedInputTokens`/`cacheWriteTokens`; the adapters read Anthropic's `cache_read_input_tokens`/`cache_creation_input_tokens` (and add them to `inputTokens`), OpenAI's `prompt_tokens_details.cached_tokens` and DeepSeek's `prompt_cache_hit_tokens`. Runs store both in `agent_runs.cached_input_tokens`/`cache_write_tokens` (migration `0009_cache_usage`) and the audit log shows them.
- **Token budget**: `history.ts` estimates four characters per token; above 24,000 tokens of replayed history it drops whole oldest turns at user-message boundaries and prepends a one-line question → answer summary. Tool calls/results are never split, the stored conversation is untouched, and the newest turns stay byte-identical for the cache.
- **Streaming**: `sse.ts` merges the event stream with a 15-second tick of `: keep-alive` comments; comments are ignored by the client parser but keep proxies from closing a quiet tool step.
- **Tests**: adapter unit tests cover cache usage shapes; `history.test.ts` covers boundaries, pairing and summaries; the agent end-to-end test checks a long follow-up is compacted.

## Thread actions notes

- **Sidebar**: every Tanya Data thread has a `···` menu with pin/unpin, archive/unarchive and delete (delete asks first). Pinned threads sort first; archived ones move to a collapsed **Arsip** group and can be opened or restored from there.
- **API**: `PATCH /api/conversations/:id` (`{ pinned?, archived? }`) and `DELETE /api/conversations/:id`, both limited to the thread owner or an admin. `conversations` gains `pinned_at`, `archived_at` and `deleted_at` (migration `0010_thread_actions`).
- **Remove means remove**: the thread disappears from lists and cannot be opened or continued (a stale id starts a new thread); its messages are deleted so the AI cannot reuse them. The `agent_runs` rows stay in the audit log.
- **Terminal**: the sidebar buttons are gone; Ctrl+` and the desktop **Aplikasi → Terminal** menu still open the panel.

## M6.2 notes: resume drafts

- **Draft** (`packages/tools/src/drafts`, table `form_drafts`, migration `0007_form_drafts`): one row per draft, fields keyed by `resume_pasien_ranap` column, with the source of each value (`data`, `khanza`, `ai`, `user`). Field definitions, limits and choices in `packages/shared/src/forms.ts`, used by the server (isiDraft, PATCH /api/drafts/:id), the card and the desktop app's checks.
- **Filled by the server, not the AI**: `buatDraftResume` reads Khanza (diagnosa_pasien/prosedur_pasien status Ranap by priority, first doctor CPPT, latest allergy, lab, radiology, tindakan, obat, kamar_inap diagnosa_awal/stts_pulang, permintaan_ranap.diagnosa). An existing resume is loaded instead (`existing`, Khanza's Ganti). The AI sees which fields are filled; clinical text is masked by key for external providers.
- **Card**: grouped like Khanza's form, source badges, required fields, length counters; saved on blur. One card per draft in the conversation (latest state; later AI updates replace it in place). Kept in transcripts.
- **Khanza** (`HarnessBridge`, command `fill`): opens RMDataResumePasienRanap like `open`, selects the saved row first when there is one (so Ganti works), then sets the 39 fields by name (text, choice only when listed, date picker); never saves. Values travel base64 in one line. Tested with the real Khanza code on local data: new visit (Simpan) and existing resume (Ganti).
- **Next forms**: resume ralan, CPPT entries.

## M6.7 notes: SIMRS login and rights

- **One login.** `apps/server/src/auth/KhanzaAccounts.ts` runs Khanza's own query, through the read pool: `admin.usere/passworde = AES_ENCRYPT(?, 'nur'/'windi')`, else `user.id_user/password` with the same keys. A row in `admin` is Admin Utama (all rights); a row in `user` gives the boolean `enum('true','false')` columns. The password is a query parameter and is never stored; `KhanzaRead` redacts every `AES_ENCRYPT` parameter in the audit log.
- **Local identity.** The audit DB keeps a `users` row per SIMRS username for sessions and audit foreign keys. Migration `0012_simrs_login` adds `source`, `rights_json`, `khanza_admin` and `rights_updated_at`, disables old local accounts and deletes their sessions. Migration `0013_user_profile` adds the linked employee/doctor/petugas names. Local password hashing and `/api/users` are gone.
- **Identity and access.** `KhanzaAccounts.profileOf` reads `pegawai.nik`, `petugas.nip` and `dokter.kd_dokter` with the username (the last is plain, not encrypted); `displayName` prefers the doctor, then employee, then petugas name. `User` now carries those names, the full granted-rights list and the derived permissions. Every agent turn starts with an `[Akun SIMRS yang sedang login]` block (`agent/identity.ts`), and the per-run `aksesSaya` tool (`packages/tools/src/access/aksesSaya.ts`) answers *"siapa saya"*, *"apa hak saya"* and *"bisa buka menu/form X / punya hak Y"* by checking the snapshot against the app map. It also names the exact Khanza right when access is denied.
- **Rights map** (`packages/shared/src/permissions.ts`): `tindakan_ralan` → CPPT ralan + fixes on `rawat_jl_pr`; `tindakan_ranap` → CPPT ranap + fixes on `rawat_inap_pr`; `data_resume_pasien` → resume + drafts; `periksa_radiologi` → radiology card and PACS; `berkas_digital_perawatan` → digital files; `kamar_inap` → fixes on `kamar_inap`/`kamar`; `registrasi` → fixes on `reg_periksa`; `bpjs_surat_kontrol`/`skdp_bpjs` → fixes on `bridging_surat_kontrol_bpjs`. Features with no Khanza menu (riwayat, Tanya Data, patient search) stay open to every SIMRS login, like the bridge.
- **Enforcement.** HTTP routes check the snapshot (`403`), `FixExecutor` paths check the table right, and the agent filters its tool list with `toolAllowed` (`hasilRadiologi`, `berkasDigital`); `dokumenPasien` checks the visit's ralan/ranap right inside the handler. The UI hides document buttons, radiology/digital-file cards and fix actions it cannot use; **Pengaturan → Akun** shows why and can `POST /api/auth/refresh`.
- **Refresh semantics.** Like Khanza, rights are read at login. `POST /api/auth/refresh` re-reads them by username (no password); a deleted Khanza account deletes its Simha sessions and returns 401.
- **Tests.** The test DB loads a compact `user`/`admin` fixture (`packages/tools/test/fixtures/khanza-auth.sql`) and the harness creates SIMRS accounts on demand. Tests cover login, wrong password/lock, admin vs staff, redacted audit params, a rights refresh (CPPT becomes 403, riwayat stays 200), account removal, doctor/petugas name linking, the identity block, `aksesSaya` allowing or denying a menu, and an e2e limited-rights account that sees only Riwayat.

## M6.8 notes: identity and access questions

- **Names.** `KhanzaAccounts.profileOf` reads `pegawai.nama` by `nik`, `petugas.nama` by `nip`, and `dokter.nm_dokter` by `kd_dokter` (plain, not AES). The display name prefers the doctor name, then the employee name, then the petugas name. Migration `0013_user_profile` stores all three on the local user row. For our live DB, 292 users match `pegawai`, 263 match `petugas`, and 32 match `dokter`; the rest fall back to the username.
- **Always in the prompt.** `agent/identity.ts` prepends `[Akun SIMRS yang sedang login]` to every user turn (username, display name, linked names, role, feature rights, fix tables). It travels in `modelText`, so it is not shown in the chat and is replayed exactly on a follow-up. The system prompt explicitly forbids answering "I cannot see who you are".
- **`aksesSaya` tool.** Built per run with the current `User` (`packages/tools/src/access/aksesSaya.ts`), so it works with the same snapshot as the permission gates. It always returns the account, the mapped feature rights and the fix tables. With `tanya`, it searches `docs/khanza-app` (menus, forms, rights) and returns `diizinkan` plus the required Khanza rights; a form also lists extra rights its buttons check. It never queries Khanza or changes data. The app map covers the Java desktop app, not the PHP webapps — the tool says so.
- **UI.** **Pengaturan → Akun** shows the employee/doctor/petugas names and a collapsible list of every granted Khanza right. Admin Utama shows "semua menu dan hak".
- **Tests.** `identity.test.ts` checks `D001` → dr. Andi Fiktif, `P001` → Ns. Rina Fiktif, the identity block in the model turn, and a menu allowed for admin / denied for the limited account. The e2e test asks "Siapa saya?" and "Bisa buka menu kasir?" through the real UI.

## M6.9 notes: AI usage & cost

- **Missing tokens (root cause).** OpenAI-compatible streaming requests did not set `stream_options.include_usage`, so OpenAI, DeepSeek and gateways returned chunks with no `usage`. Every run therefore stored `NULL` for input/output/cached/cache-write tokens. The adapter now sends it and retries once without the field when a server answers 400/422 (older or stricter servers). Anthropic already reported usage.
- **Aggregation.** `apps/server/src/usage.ts` groups `agent_runs` by local calendar day, provider, model and `asked_by`; the report is built from those groups so totals, days, models and users always add up. Durations come from `finished_at - started_at`; running rows are excluded from the slow list. Days without runs are included with zeros. The audit DB stays the only source; nothing is added to Khanza.
- **Cost.** `packages/shared/src/usage.ts` holds the built-in list prices (USD per 1M tokens) and `costUsdOf`: uncached input at the input price, cache reads at the cached price, cache writes at the write price, output at the output price. Cached and written tokens are subtracted from `input_tokens` (both adapters count them inside it). Unknown models stay unpriced and are reported as such instead of showing a fake zero.
- **Price book.** `PUT /api/usage/prices` upserts provider+model rows in the `settings` table (`usage_prices`), plus an optional USD→IDR rate; other saved rows stay. The dialog on the page only sends models in the current report, so switching provider later does not erase the previous model's price. An all-empty row on an unpriced model is skipped (still unpriced, not free).
- **CSV.** `GET /api/usage/export` returns one row per run for the period (started/finished, user, mode, provider, model, status, steps, all four token fields, estimated USD, duration, question, error) with the shared CSV escaping: quoted commas, doubled quotes, formula prefixes and a UTF-8 BOM.
- **Access.** All three routes are admin-only (`403` for staff), dates must be a valid range of at most 366 days (`400`), and price changes are written to `app_events` as `usage_prices_changed`.
- **Tests.** `apps/server/test/usage.test.ts` seeds runs with known tokens and statuses: totals, cache hit rate, per-day/per-model/per-user cost, slowest order, failure grouping, date validation, admin gate and CSV escaping. `agent.test.ts` checks that usage from two model turns is summed into the run row. The e2e smoke test opens the tab, checks the charts and exports the CSV.

## Decisions and questions

1. **MySQL or MariaDB?** Khanza often runs on MariaDB. `MAX_EXECUTION_TIME` only exists in MySQL; MariaDB uses `SET STATEMENT max_statement_time=10 FOR SELECT ...`. The plan is to detect the server at startup and use the right one, plus an Effect timeout as a backstop. The `inspect-schema` output shows which one you run.
2. **Write allow-list.** Proposed: `kamar_inap`, `kamar`, `reg_periksa`, `rawat_jl_pr`, `rawat_inap_pr`, `bridging_surat_kontrol_bpjs`. Add or remove tables?
3. **Test database.** Tests use synthetic data only, never a copy of real patient data. Docker is the default; tests can also point at any local MariaDB through an env var.
4. **Effect 4.** Effect is now v4 (`effect@4.0.5`): SQL, HTTP and platform modules moved into `effect` itself. The code targets v4.
5. **Extra tables.** Besides the brief's list, `inspect-schema` also checks `penjab` (BPJS vs umum), `resep_obat` / `resep_dokter` (prescriptions) and `dpjp_ranap` (DPJP for the patient card).

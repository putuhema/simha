# Plan

Status: **M4 done, waiting for your test.** Next: M5.

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
- **M5. Web UI.** Tiket, Tanya Data (charts, tables, favorites), Pengaturan (provider, audit log). Login. Playwright smoke tests.
- **M6. Desktop.** Electron app wrapping the UI, can start the local server, Windows installer.
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

## Decisions and questions

1. **MySQL or MariaDB?** Khanza often runs on MariaDB. `MAX_EXECUTION_TIME` only exists in MySQL; MariaDB uses `SET STATEMENT max_statement_time=10 FOR SELECT ...`. The plan is to detect the server at startup and use the right one, plus an Effect timeout as a backstop. The `inspect-schema` output shows which one you run.
2. **Write allow-list.** Proposed: `kamar_inap`, `kamar`, `reg_periksa`, `rawat_jl_pr`, `rawat_inap_pr`, `bridging_surat_kontrol_bpjs`. Add or remove tables?
3. **Test database.** Tests use synthetic data only, never a copy of real patient data. Docker is the default; tests can also point at any local MariaDB through an env var.
4. **Effect 4.** Effect is now v4 (`effect@4.0.5`): SQL, HTTP and platform modules moved into `effect` itself. The code targets v4.
5. **Extra tables.** Besides the brief's list, `inspect-schema` also checks `penjab` (BPJS vs umum), `resep_obat` / `resep_dokter` (prescriptions) and `dpjp_ranap` (DPJP for the patient card).

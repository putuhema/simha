# Plan

Status: **M1 done, waiting for your test.** Next: M2.

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
- **M2. Agent.** Tool registry, LLM service with `anthropic`, `openai-compat` and `fake` adapters, agent loop, `POST /ask` and `POST /tickets/:id/investigate` with SSE, PII masking. Demo with two providers (e.g. Claude + Ollama).
- **M3. Fixes.** `usulkanPerbaikan` → preview → approve → execute in a transaction → rollback. Tests prove a row-count mismatch rolls back and nothing is written without an approval row in the audit log.
- **M4. Tanya Data tools.** `lihatSkema`, guarded `jalankanQueryBaca`, `tampilkan`. Tests prove non-SELECT, multiple statements and deny-listed columns are rejected.
- **M5. Web UI.** Tiket, Tanya Data (charts, tables, favorites), Pengaturan (provider, audit log). Login. Playwright smoke tests.
- **M6. Desktop.** Electron app wrapping the UI, can start the local server, Windows installer.
- **M7. MCP.** Same tools over stdio and streamable HTTP, README section for Claude Desktop / Claude Code.

## M1 notes

- The DB pools and audit log live in `packages/tools` (not `apps/server`) so the MCP server (M7) uses the same guards and the same audit log.
- `daftarTindakan` also reads `rawat_jl_dr`, `rawat_jl_drpr`, `rawat_inap_dr` and `rawat_inap_drpr`. The brief listed only the `_pr` tables, but most tindakan in our data are in the `_drpr` tables. Their columns were checked with `inspect-schema` first.
- The read layer refuses to start if the read user can write (checked with `SHOW GRANTS`). The write layer refuses a user with global privileges, PROXY or GRANT OPTION.
- Dates and times are returned as stored strings (`"2026-10-21"`, `"0000-00-00"`) to avoid time-zone shifts.
- `cariPasien`, `dataSep` and the other tools never select NIK, phone numbers or addresses, so there is nothing to mask in their output. General PII masking for AI-written queries comes in M2/M4.

## Decisions and questions

1. **MySQL or MariaDB?** Khanza often runs on MariaDB. `MAX_EXECUTION_TIME` only exists in MySQL; MariaDB uses `SET STATEMENT max_statement_time=10 FOR SELECT ...`. The plan is to detect the server at startup and use the right one, plus an Effect timeout as a backstop. The `inspect-schema` output shows which one you run.
2. **Write allow-list.** Proposed: `kamar_inap`, `kamar`, `reg_periksa`, `rawat_jl_pr`, `rawat_inap_pr`, `bridging_surat_kontrol_bpjs`. Add or remove tables?
3. **Test database.** Tests use synthetic data only, never a copy of real patient data. Docker is the default; tests can also point at any local MariaDB through an env var.
4. **Effect 4.** Effect is now v4 (`effect@4.0.5`): SQL, HTTP and platform modules moved into `effect` itself. The code targets v4.
5. **Extra tables.** Besides the brief's list, `inspect-schema` also checks `penjab` (BPJS vs umum), `resep_obat` / `resep_dokter` (prescriptions) and `dpjp_ranap` (DPJP for the patient card).

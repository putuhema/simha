# Simha review — what to add, what to optimize

Reviewed 2026-10-24 against commit `da299e8` ("Polish motion across the UI").

Current state: `pnpm verify` is green — typecheck, lint, **347 tests**, app-map check
(1,094 buttons / 1,079 forms, Khanza commit `2e695e7`). 19 Playwright smoke tests. `pnpm knip`
reports nothing. The safety model (read-only user, fix allow-list, approval + rollback,
PII masking, audit DB) is unusually solid for an internal tool.

So this is not a "fix the basics" review. It is a list of gaps between a very good
prototype and something a hospital can run for years, plus the places where the UI
does more work than it needs to.

---

## A. What to add

### P0 — production safety (do these before a wider rollout)

| # | Gap | Why it matters | Effort |
|---|-----|----------------|--------|
| 1 | **TLS is not built in.** README has one line: "behind HTTPS (e.g. a reverse proxy), set `COOKIE_SECURE=true`". | With `SERVER_HOST=0.0.0.0` the SIMRS password travels the hospital LAN in plaintext, and the session cookie can be sniffed. Hospital networks are flat and often shared with guest Wi-Fi. | S–M |
| 2 | **No operational logs.** Nothing in `apps/server/src` or `packages/tools/src` calls `console.*` or `Effect.log`. | When a nurse says "it answered wrong at 09:15", there is no request log, no startup banner, no SQL error trail. The audit DB has rows, but nobody can find the failing request. | S |
| 3 | **`/api/health` lies after startup.** It returns `khanza: { connected: true, readOnly: true }` as constants (`apps/server/src/http/routes.ts`). | If the MariaDB box reboots at 02:00, the sidebar still says "connected" and every question fails with a confusing tool error. No readiness probe, no reconnect signal. | S |
| 4 | **The audit DB has no lifecycle.** `AuditLog.ts` says "Nothing is deleted"; no retention, no prune, no backup, no VACUUM. Measured here: **7 MB for 120 runs / 585 tool calls / 1,980 queries** (~58 KB per run). At 100 questions/day that is ~2 GB/year. | A hospital server will fill its disk, SQLite pages fragment, and the audit log — the compliance artifact — has no backup. | M |
| 5 | **No CI and no release pipeline.** No `.github/`, no remote, no pre-commit hook; `verify` only runs when someone remembers. Desktop version is `0.0.0`, `signAndEditExecutable: false`, no `autoUpdater`. | Every change is trusted by hand. Windows SmartScreen warns on install, and IT has to reinstall a new `.exe` manually for every fix. | M |
| 6 | **Abuse controls are thin.** Login lockout is an in-memory `Map` (5 tries / 60 s, reset on restart). `POST /api/ask` has no per-user limit. Expired sessions are never deleted. | One compromised or curious account can burn a month of AI budget, and stale sessions accumulate forever. | S |

Concrete shape for these:

1. **TLS** — either (a) document a Caddy/nginx block and ship it in `docs/`, or (b) add
   `SERVER_TLS_CERT` / `SERVER_TLS_KEY` to `config.ts` and pass them to `createServer`.
   Option (a) is a day; option (b) is nicer for the desktop "local server" mode.
2. **Logging** — one small `Effect.log` wrapper at the HTTP boundary (method, path, status,
   user, ms), plus startup/shutdown lines and the existing caught errors. Do not log patient
   data or question text; log ids and durations. Write to stdout; the desktop already captures it.
3. **Health** — cache a `SELECT 1` for ~10 s, return `khanza: { connected, error, checkedAt }`
   and `db: { ok }` for SQLite. Split `/api/health` (public, cheap) from an admin `/api/diagnostics`
   (pool stats, last error, audit size, schema/map freshness).
4. **Audit DB** — add `docs`-worthy maintenance: prune `conversation_messages`, `tool_calls`,
   `queries`, `query_results`, `render_blocks` older than N days (keep `agent_runs`, `fix_events`,
   `app_events`), `PRAGMA optimize` weekly, `VACUUM` monthly, and a daily file copy while the
   DB is idle. A `pnpm audit:backup` script plus a Windows Task Scheduler line is enough.
5. **CI** — GitHub Actions (or GitLab) running `pnpm verify` + `pnpm e2e` (Playwright chromium)
   on push; `version` bumped per release; electron-builder `publish` + `electron-updater` with a
   code-signing certificate. The 781 MB stale `apps/desktop/release/` in the workspace should be
   cleared (it still contains a `SIMRS Harness.exe` from before the rebrand).
6. **Limits** — persist login failures in `app_events`/a small table instead of a `Map`, add a
   per-user token/ask budget (e.g. 50 asks/hour, env-tunable), delete `sessions` where
   `expires_at < now` on login.

### P1 — product gaps

7. **Pending-fix inbox.** `GET /api/fixes?status=pending` exists, but the UI never calls it.
   Fixes only appear inside the chat thread that produced them (`FixCard`). If the asker closes
   the app, nobody sees the proposal again. Add a **Perbaikan** page (pending / approved / applied /
   failed / rolled_back, filter by table and user, row counts, "why", before/after) and a badge
   in the sidebar when `stats.perbaikanMenunggu > 0`. `/api/stats` already returns that number
   and is also unused. This is the single biggest workflow hole.
8. **M5.2 — routine checks + agent test set.** Already next on `docs/PLAN.md`. The value is not
   only proactive alerts; it is a **fixed suite of questions with known answers** so a provider,
   model or prompt change can be scored before it reaches staff. Today the only AI tests use the
   scripted `fake` adapter, so a real model regression is invisible.
9. **AI usage & cost page.** Every run already stores provider, model, steps, input/output/
   cached tokens and duration. Aggregate them: runs/day, tokens/day, cache hit rate, cost estimate,
   failures by provider, slowest questions, per-user usage, CSV export. Cheap to build, and it is
   what an admin needs to justify the AI bill.
10. **Search across history.** The sidebar filters only the first question, client-side
    (`Sidebar.tsx`). Staff will ask "bulan lalu kita pernah bahas pasien ini". Add SQLite FTS5 over
    `agent_runs.question` + `final_text` (and knowledge), a `/api/search` endpoint, and a results
    list that opens the thread.
11. **M7 — MCP server.** Planned; the tool registry + guards already make it a thin wrapper.
    Worth doing before more UI work because it gives Claude Desktop/Code access to the same safe
    tools with the same audit log.
12. **Deployment kit.** There is no "install on the hospital server" story beyond `pnpm start`:
    Windows service/auto-start, daily backup task, reverse-proxy config, firewall ports, upgrade
    steps, restore drill. Half a day of docs + two scripts removes the scariest support call.

### P2 — later

- **Share/export an investigation**: one-click PDF or copy-to-WhatsApp summary (title, findings,
  diagnosis, proposed fix, SQL). Printing exists for patient documents, not for answers.
- **Admin access simulator**: `aksesSaya` answers for yourself; IT often needs "can user X open
  menu Y?" (read-only lookup of another Khanza account).
- **Session/device admin**: list active sessions, force logout, see last seen.
- **Khanza bridge**: billing (ranap/ralan) and SEP, listed as "later" in the M6.1 notes.
- **Schema-drift warning**: compare `docs/schema.md` and the app-map commit to live Khanza at
  boot; show "peta/skema lebih lama dari Khanza" instead of silently answering from stale docs.

---

## B. What to optimize

### 1. The streaming path re-renders and re-parses too much (biggest UI win)

Every `text_delta` replaces the whole `turns` array in the Zustand store
(`stores/tanya.ts`). Consequences on the **entire thread**, not just the streaming answer:

- `TanyaPage` re-renders, `cardsFromTurns(turns)` recomputes, and every `Turn` renders again
  (`Turn` is not memoized).
- `useSmoothText` calls `setFrame` on **every animation frame**, and each frame renders
  `ReactMarkdown` + `remark-gfm` over the whole answer text (`Markdown.tsx`). Long answers pay a
  full markdown parse ~60×/s on hospital-grade CPUs.

Fix, in order of payoff:

1. Wrap `Turn` in `React.memo` and keep turn objects stable for non-streaming turns (they already
   are, except the whole array is new — memo works if each turn object identity is preserved;
   `applyEvent` only replaces the active turn, so this is a small change).
2. Subscribe the streaming turn separately: `useTanya((s) => s.turns.find(t => t.key === activeKey))`
   in a leaf component, so the thread list does not re-render per token.
3. Throttle `useSmoothText` to ~30 fps, and parse markdown only when new text is appended, not on
   every reveal frame. Memoize the parsed blocks of the finished prefix and only parse the tail.
4. Derive `cards` from block identity/count, not from the whole `turns` array, or move it into
   `cardsOfTurn` per turn.

Target: typing should stay smooth while a 3,000-character answer streams on a 2-core PC.

### 2. The production bundle ships source maps and a heavy preloaded chunk

- `apps/web/dist` is **12 MB**; `vite.config.ts` sets `sourcemap: true`, and `static.ts` serves
  `/assets/*.js.map` publicly (no auth). Anyone on the LAN can read the full source, and the
  desktop package copies them too. Use `sourcemap: "hidden"` for local debugging, and delete
  `*.map` from the release build / desktop `extraResources`.
- Initial HTML preloads `Field-*.js` (233 KB raw, **79 KB gzip**) before login. That chunk is
  Base UI internals pulled in through the sidebar menus (`@base-ui/react/menu`). Either lazy-load
  the shell's menus, or import only the primitives needed and keep the login page at
  `index.js` (~83 KB gzip) + CSS.
- Consider `build.rollupOptions.output.manualChunks` to keep stable vendor chunks (React, router)
  across deploys; assets are already immutable-cached, so this mainly helps update size.

### 3. Audit-log queries will crawl, and the DB grows forever

Measured query plans on `data/audit.sqlite`:

- `app_events` filter/sort by `at` → **SCAN + temp B-tree** (no index).
- `agent_runs WHERE conversation_id = ?` → **SCAN** (no index; every thread open).
- `queries` / `fixes.run_id` / `sessions.expires_at` also unindexed.

Add, in a new migration:

```sql
CREATE INDEX agent_runs_conversation ON agent_runs (conversation_id, started_at);
CREATE INDEX app_events_at ON app_events (at);
CREATE INDEX queries_executed ON queries (executed_at);
CREATE INDEX fixes_run ON fixes (run_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
```

Also: the audit page runs `SELECT COUNT(*)` plus `LIKE '%q%'` over the whole table for every
page load (`views.ts`). Keep it, but combine with retention; if search becomes important, FTS5
is the real answer (see add #10). And note `PRAGMA foreign_keys` is `0`, so the declared
`REFERENCES` are documentation only — either turn it on (after a cleanup) or stop implying
enforcement.

### 4. Login and AI spend need persistent limits

`Auth.ts` keeps the failure counter in a `Map` inside the layer. A restart clears it, and a second
server process would have its own. Move it to SQLite with an exponential backoff (5 fails → 1 min,
10 → 5 min, 20 → 30 min), and purge expired sessions on login. Add a simple per-user ask budget
(`ASK_LIMIT_PER_HOUR`, default generous) returning `429` with a clear Indonesian message — this
also protects against a stuck client retrying in a loop.

### 5. Health and status should reflect reality

Covered in P0 #3. The UI already polls `/api/health` every 60 s (`AppShell.tsx`), so a real ping
costs one `SELECT 1` per minute.

### 6. Small things worth fixing while you are there

- `static.ts` tells users to run `pnpm dev`, which does not exist; the root scripts are
  `start` + `dev:web`. Add a root `dev` script (concurrently server + web) or fix the message.
- `DataTable` renders all 500 rows at once. Sorting 500 rows is fine today; if query caps rise,
  paginate to 100 or virtualize the body.
- Test gaps: no component tests for `TanyaPage`/`Composer`, e2e is Chromium-only, and nothing
  exercises TLS/health/retention. CI plus one WebKit run at 400 px would cover most of it.
- `apps/desktop/release/` (781 MB) is ignored by git but stale; clear it before shipping to avoid
  uploading the old-branded installer by mistake.

---

## C. Suggested order

**Sprint 1 — make it safe to leave running (≈1 week):**
TLS + reverse-proxy doc · request/error logging · real health check · audit retention + indexes +
backup script · CI · login lockout in SQLite · expired-session cleanup · ask rate limit.

**Sprint 2 — close the workflow hole (≈1 week):**
Perbaikan inbox + sidebar badge · AI usage/cost page · sourcemap/chunk cleanup · streaming render
optimization (memo + throttled markdown).

**Sprint 3 — prove the AI (≈1–2 weeks):**
M5.2 eval suite + routine checks · conversation search · then M7 (MCP) · auto-update + signing.

The order is deliberate: nothing in Sprint 3 matters if a DB outage, a disk-full audit log, or a
sniffed password takes the tool offline first.

---

## D. What is already good (do not rebuild)

- Rights model: Khanza right → Simha capability, enforced in HTTP, tool list and UI, with a clear
  403 message. Most tools would have stopped at hiding buttons.
- Fix pipeline: preview → approval row committed first → transaction → row-count check →
  before-image → verified rollback. This is stronger than most production admin tools.
- Select guard and privacy masking: whole-query walk, subqueries/CTEs covered, COUNT-only
  aggregates, clinical free text withheld. Keep this as the bar for every new tool.
- Prompt caching discipline, history compaction, SSE keep-alive: thoughtful and tested.
- App map generated from Khanza source with a staleness gate: the right call for "where is this
  menu?" questions.

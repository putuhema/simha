/**
 * Read models for the web UI, built from the audit DB (and two counts from
 * Khanza): the stat row, conversation transcripts, recent Tanya Data threads
 * and the audit log.
 *
 * Transcripts are rebuilt from agent_runs, tool_calls, render_blocks and
 * fixes, so a ticket's "Yang dicek AI" steps and a chat's charts look the same
 * after a reload as while they streamed. Tool outputs come from the audit log
 * (unmasked, cut at 50,000 characters).
 */
import type {
  AuditKind,
  AuditPage,
  ConversationSummary,
  RenderBlock,
  RunTranscript,
  Stats,
  ToolStep,
  Transcript,
} from "@simrs/shared";
import { KhanzaRead, toDocumentInfo, type DocumentRow } from "@simrs/tools";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

const STATS_CACHE_MS = 30_000;

const parseJson = (json: string | null): unknown => {
  if (json === null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null; // cut by the audit log's size limit
  }
};

interface RunRow {
  readonly id: string;
  readonly kind: "ask" | "ticket";
  readonly question: string;
  readonly asked_by: string | null;
  readonly provider: string;
  readonly model: string;
  readonly status: string;
  readonly final_text: string | null;
  readonly error: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
}

interface StepRow {
  readonly id: string;
  readonly session_id: string;
  readonly tool: string;
  readonly kind: string;
  readonly input_json: string;
  readonly status: string;
  readonly output_json: string | null;
  readonly error: string | null;
  readonly duration_ms: number | null;
  readonly started_at: string;
}

/** What each audit tab shows: table, time column, columns and the columns `q` searches. */
const AUDIT: Record<AuditKind, { from: string; time: string; columns: string; search: ReadonlyArray<string> }> = {
  runs: {
    from: "agent_runs",
    time: "started_at",
    columns:
      "id, started_at, kind, question, asked_by, provider, model, mask_pii, status, steps, input_tokens, output_tokens, error",
    search: ["question", "asked_by", "model", "provider"],
  },
  tools: {
    from: "tool_calls",
    time: "started_at",
    columns: "id, started_at, session_id, tool, kind, status, duration_ms, substr(input_json, 1, 500) AS input, error",
    search: ["tool", "input_json", "session_id"],
  },
  queries: {
    from: "queries",
    time: "executed_at",
    columns: "id, executed_at, pool, tool_call_id, fix_id, sql, params_json AS params, row_count, duration_ms, error",
    search: ["sql", "pool"],
  },
  fixes: {
    from: "fix_events e JOIN fixes f ON f.id = e.fix_id",
    time: "e.at",
    columns: "e.id, e.at, e.action, e.actor, e.detail, f.id AS fix_id, f.title, f.table_name, f.status",
    search: ["e.actor", "f.title", "f.table_name", "e.action"],
  },
  events: {
    from: "app_events",
    time: "at",
    columns: "id, at, action, actor, detail, ip",
    search: ["action", "actor", "detail"],
  },
};

interface AuditFilter {
  readonly kind: AuditKind;
  readonly q?: string | undefined;
  /** YYYY-MM-DD, inclusive. */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const read = yield* KhanzaRead;

  let statsCache: { at: number; value: Pick<Stats, "registrasiHariIni" | "pasienRawatInap" | "khanzaError"> } | undefined;

  const khanzaCounts = Effect.gen(function* () {
    if (statsCache && Date.now() - statsCache.at < STATS_CACHE_MS) return statsCache.value;
    const value = yield* read
      .query<{ registrasi: number; rawat_inap: number }>(
        (s) => s`
          SELECT
            (SELECT COUNT(*) FROM reg_periksa WHERE tgl_registrasi = CURDATE() AND stts <> 'Batal') AS registrasi,
            (SELECT COUNT(DISTINCT no_rawat) FROM kamar_inap WHERE stts_pulang = '-') AS rawat_inap`,
      )
      .pipe(
        Effect.map(([r]) => ({
          registrasiHariIni: Number(r?.registrasi ?? 0),
          pasienRawatInap: Number(r?.rawat_inap ?? 0),
          khanzaError: null,
        })),
        Effect.catch((e) => Effect.succeed({ registrasiHariIni: null, pasienRawatInap: null, khanzaError: e.message })),
      );
    statsCache = { at: Date.now(), value };
    return value;
  });

  const stats = Effect.gen(function* () {
    const khanza = yield* khanzaCounts;
    const [local] = yield* sql<{ tickets: number; fixes: number }>`
      SELECT (SELECT COUNT(*) FROM tickets WHERE status <> 'closed') AS tickets,
             (SELECT COUNT(*) FROM fixes WHERE status = 'pending') AS fixes`;
    return { ...khanza, tiketTerbuka: local?.tickets ?? 0, perbaikanMenunggu: local?.fixes ?? 0 } satisfies Stats;
  }).pipe(Effect.orDie);

  const transcriptOf = (conversationId: string | null) =>
    Effect.gen(function* () {
      if (conversationId === null) return { conversationId: null, runs: [] } satisfies Transcript;
      const runs = yield* sql<RunRow>`
        SELECT id, kind, question, asked_by, provider, model, status, final_text, error, started_at, finished_at
        FROM agent_runs WHERE conversation_id = ${conversationId} ORDER BY started_at`;
      const ids = runs.map((r) => r.id);
      if (ids.length === 0) return { conversationId, runs: [] } satisfies Transcript;
      const steps = yield* sql<StepRow>`
        SELECT id, session_id, tool, kind, input_json, status, output_json, error, duration_ms, started_at
        FROM tool_calls WHERE ${sql.in("session_id", ids)} ORDER BY started_at`;
      const blocks = yield* sql<{ session_id: string; block_json: string }>`
        SELECT session_id, block_json FROM render_blocks WHERE ${sql.in("session_id", ids)} ORDER BY created_at`;
      const documents = yield* sql<DocumentRow & { session_id: string }>`
        SELECT id, kind, title, subject, summary, actor, created_at, session_id FROM documents
        WHERE ${sql.in("session_id", ids)} ORDER BY created_at`;
      const fixes = yield* sql<{ id: string; run_id: string }>`
        SELECT id, run_id FROM fixes WHERE ${sql.in("run_id", ids)} ORDER BY created_at`;

      const toStep = (s: StepRow): ToolStep => ({
        id: s.id,
        name: s.tool,
        kind: s.kind,
        input: parseJson(s.input_json),
        ok: s.status === "ok",
        output: parseJson(s.output_json),
        error: s.error,
        durationMs: s.duration_ms,
        startedAt: s.started_at,
      });
      return {
        conversationId,
        runs: runs.map(
          (r): RunTranscript => ({
            id: r.id,
            kind: r.kind,
            question: r.question,
            askedBy: r.asked_by,
            provider: r.provider,
            model: r.model,
            status: r.status,
            finalText: r.final_text,
            error: r.error,
            startedAt: r.started_at,
            finishedAt: r.finished_at,
            steps: steps.filter((s) => s.session_id === r.id).map(toStep),
            blocks: blocks.filter((b) => b.session_id === r.id).map((b) => JSON.parse(b.block_json) as RenderBlock),
            documents: documents.filter((d) => d.session_id === r.id).map(toDocumentInfo),
            fixIds: fixes.filter((f) => f.run_id === r.id).map((f) => f.id),
          }),
        ),
      } satisfies Transcript;
    }).pipe(Effect.orDie);

  const conversation = (id: string) =>
    Effect.gen(function* () {
      const [row] = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${id}`.pipe(Effect.orDie);
      return row ? yield* transcriptOf(row.id) : undefined;
    });

  const ticketTranscript = (ticketId: string) =>
    Effect.gen(function* () {
      const [row] = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE ticket_id = ${ticketId}`.pipe(Effect.orDie);
      return yield* transcriptOf(row?.id ?? null);
    });

  /** Recent Tanya Data threads; `askedBy` limits them to one user. */
  const conversations = (askedBy: string | undefined) =>
    sql<{ id: string; first_question: string; asked_by: string | null; run_count: number; last_at: string }>`
      SELECT c.id,
        (SELECT question FROM agent_runs WHERE conversation_id = c.id ORDER BY started_at LIMIT 1) AS first_question,
        (SELECT asked_by FROM agent_runs WHERE conversation_id = c.id ORDER BY started_at LIMIT 1) AS asked_by,
        COUNT(r.id) AS run_count, MAX(r.started_at) AS last_at
      FROM conversations c JOIN agent_runs r ON r.conversation_id = c.id
      WHERE c.kind = 'ask' ${askedBy ? sql`AND r.asked_by = ${askedBy}` : sql``}
      GROUP BY c.id ORDER BY last_at DESC LIMIT 50`.pipe(
      Effect.map((rows) =>
        rows.map(
          (r): ConversationSummary => ({
            id: r.id,
            firstQuestion: r.first_question,
            askedBy: r.asked_by,
            runCount: r.run_count,
            lastAt: r.last_at,
          }),
        ),
      ),
      Effect.orDie,
    );

  const audit = (filter: AuditFilter) =>
    Effect.gen(function* () {
      const spec = AUDIT[filter.kind];
      const where: Array<string> = [];
      const params: Array<string> = [];
      if (filter.q) {
        where.push(`(${spec.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
        const pattern = `%${filter.q.replaceAll(/[\\%_]/g, (m) => `\\${m}`)}%`;
        params.push(...spec.search.map(() => pattern));
      }
      if (filter.from) {
        where.push(`${spec.time} >= ?`);
        params.push(filter.from);
      }
      if (filter.to) {
        // Inclusive day: everything before the next day.
        const next = new Date(`${filter.to}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        where.push(`${spec.time} < ?`);
        params.push(next.toISOString().slice(0, 10));
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [count] = yield* sql.unsafe<{ n: number }>(`SELECT COUNT(*) AS n FROM ${spec.from} ${clause}`, params);
      const rows = yield* sql.unsafe<Record<string, unknown>>(
        `SELECT ${spec.columns} FROM ${spec.from} ${clause} ORDER BY ${spec.time} DESC LIMIT ? OFFSET ?`,
        [...params, filter.limit, filter.offset],
      );
      return { kind: filter.kind, rows, total: count?.n ?? 0 } satisfies AuditPage;
    }).pipe(Effect.orDie);

  return { stats, conversation, ticketTranscript, conversations, audit };
});

export class Views extends Context.Service<Views, Effect.Success<typeof make>>()("simrs/Views") {}

/** Needs the audit DB's SqlClient and KhanzaRead. */
export const ViewsLive = Layer.effect(Views, make);

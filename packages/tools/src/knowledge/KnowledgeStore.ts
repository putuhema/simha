/**
 * What the AI learned about this hospital, in the audit SQLite DB (`knowledge`).
 *
 * Two kinds of items:
 * - examples: a question with the SQL that answered it. Saved automatically
 *   after an answer was shown (unverified), or by a 👍 (verified).
 * - notes: facts about the schema, local codes or how staff want answers.
 *   Saved by the AI (`catatPengetahuan`), by a 👎 with a correction, or by staff.
 *
 * `relevant` picks the items that match a new question; the agent adds them to
 * the question it sends to the AI. Nothing here is ever used to change Khanza.
 */
import type { Knowledge, KnowledgeKind, KnowledgeSource, RenderType } from "@simha/shared";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { rank, type Match } from "./search.ts";
interface KnowledgeRow {
  readonly id: string;
  readonly kind: KnowledgeKind;
  readonly source: KnowledgeSource;
  readonly text: string;
  readonly sql: string | null;
  readonly render_type: RenderType | null;
  readonly title: string | null;
  readonly verified: number;
  readonly active: number;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly uses: number;
  readonly last_used_at: string | null;
}

const toKnowledge = (r: KnowledgeRow): Knowledge => ({
  id: r.id,
  kind: r.kind,
  source: r.source,
  text: r.text,
  sql: r.sql,
  renderType: r.render_type,
  title: r.title,
  verified: r.verified === 1,
  active: r.active === 1,
  createdBy: r.created_by,
  createdAt: r.created_at,
  uses: r.uses,
  lastUsedAt: r.last_used_at,
});

export interface NewKnowledge {
  readonly kind: KnowledgeKind;
  readonly source: KnowledgeSource;
  readonly text: string;
  readonly sql?: string | null;
  readonly renderType?: RenderType | null;
  readonly title?: string | null;
  readonly verified: boolean;
  /** The chat result an example came from (for 👍 / 👎 later). */
  readonly blockId?: string | null;
  readonly runId?: string | null;
  readonly createdBy: string | null;
}

export interface KnowledgeChange {
  readonly text?: string;
  readonly source?: KnowledgeSource;
  readonly verified?: boolean;
  readonly active?: boolean;
}

/** Most items given to the AI per question, so the prompt stays small. */
export const MAX_RELEVANT = 5;

/** A note only needs to be roughly on topic; an example must fit the question closely. */
const NOTE_MIN_SCORE = 0.25;
const EXAMPLE_MIN_SCORE = 0.35;

export interface RelevantKnowledge {
  readonly item: Knowledge;
  readonly score: number;
}

/** Same question, ignoring case, spaces and punctuation. */
const cleanQuestion = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const sameQuestion = (a: string, b: string) => cleanQuestion(a) === cleanQuestion(b);

const now = () => new Date().toISOString();

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const get = (id: string) =>
    sql<KnowledgeRow>`SELECT * FROM knowledge WHERE id = ${id}`.pipe(
      Effect.map(([r]) => (r ? toKnowledge(r) : undefined)),
      Effect.orDie,
    );

  const add = (input: NewKnowledge) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID();
      const at = now();
      yield* sql`INSERT INTO knowledge ${sql.insert({
        id,
        kind: input.kind,
        source: input.source,
        text: input.text.trim(),
        sql: input.sql ?? null,
        render_type: input.renderType ?? null,
        title: input.title ?? null,
        verified: input.verified ? 1 : 0,
        active: 1,
        block_id: input.blockId ?? null,
        run_id: input.runId ?? null,
        created_by: input.createdBy,
        created_at: at,
        updated_at: at,
      })}`;
      return (yield* get(id)) as Knowledge;
    }).pipe(Effect.orDie);

  /** Everything, active first, then newest first (the knowledge page). */
  const list = sql<KnowledgeRow>`SELECT * FROM knowledge ORDER BY active DESC, created_at DESC LIMIT 1000`.pipe(
    Effect.map((rows) => rows.map(toKnowledge)),
    Effect.orDie,
  );

  const update = (id: string, change: KnowledgeChange) =>
    Effect.gen(function* () {
      const existing = yield* get(id);
      if (!existing) return undefined;
      yield* sql`UPDATE knowledge SET ${sql.update({
        ...(change.text !== undefined ? { text: change.text.trim() } : {}),
        ...(change.source !== undefined ? { source: change.source } : {}),
        ...(change.verified !== undefined ? { verified: change.verified ? 1 : 0 } : {}),
        ...(change.active !== undefined ? { active: change.active ? 1 : 0 } : {}),
        updated_at: now(),
      })} WHERE id = ${id}`;
      return yield* get(id);
    }).pipe(Effect.orDie);

  const remove = (id: string) =>
    sql<{ id: string }>`DELETE FROM knowledge WHERE id = ${id} RETURNING id`.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.orDie,
    );

  /** The example saved from a chat result, if any (active one first). */
  const forBlock = (blockId: string) =>
    sql<KnowledgeRow>`SELECT * FROM knowledge WHERE block_id = ${blockId} ORDER BY active DESC, created_at LIMIT 1`.pipe(
      Effect.map(([r]) => (r ? toKnowledge(r) : undefined)),
      Effect.orDie,
    );

  /** The note saved from a whole answer (run-level feedback), if any. */
  const forRun = (runId: string) =>
    sql<KnowledgeRow>`SELECT * FROM knowledge WHERE run_id = ${runId} AND kind = 'note' ORDER BY created_at LIMIT 1`.pipe(
      Effect.map(([r]) => (r ? toKnowledge(r) : undefined)),
      Effect.orDie,
    );

  /** Turn off everything saved from this result (a 👎); the row stays for the audit trail. */
  const deactivateForBlock = (blockId: string) =>
    sql`UPDATE knowledge SET active = 0, updated_at = ${now()} WHERE block_id = ${blockId}`.pipe(Effect.asVoid, Effect.orDie);

  /** An active example for the same question already exists (so a new automatic one is not needed). */
  const hasExample = (question: string) =>
    sql<{ text: string }>`SELECT text FROM knowledge WHERE kind = 'example' AND active = 1`.pipe(
      Effect.map((rows) => rows.some((r) => sameQuestion(r.text, question))),
      Effect.orDie,
    );

  /**
   * The active items that best match `question`, best first, at most
   * MAX_RELEVANT. Each one is counted as used. Notes may be a looser match
   * than examples: a note about a table is still useful for a loosely worded
   * question, while an example should look like the question asked.
   */
  const relevant = (question: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<KnowledgeRow>`SELECT * FROM knowledge WHERE active = 1`;
      const items = rows.map(toKnowledge);
      const matches: ReadonlyArray<Match<Knowledge>> = rank(
        question,
        items.map((k) => ({ ...k, text: k.title ? `${k.text} ${k.title}` : k.text, original: k })),
        MAX_RELEVANT * 3,
        0.2,
      )
        .filter((m) => m.score >= (m.item.original.kind === "note" ? NOTE_MIN_SCORE : EXAMPLE_MIN_SCORE))
        .slice(0, MAX_RELEVANT)
        .map((m) => ({ item: m.item.original, score: m.score }));
      if (matches.length > 0) {
        const at = now();
        const ids = matches.map((m) => m.item.id);
        yield* sql`UPDATE knowledge SET uses = uses + 1, last_used_at = ${at} WHERE ${sql.in("id", ids)}`;
      }
      return matches;
    }).pipe(Effect.orDie);

  return { add, get, list, update, remove, forBlock, forRun, deactivateForBlock, hasExample, relevant };
});

export class KnowledgeStore extends Context.Service<KnowledgeStore, Effect.Success<typeof make>>()("simha/KnowledgeStore") {}

/** Needs the audit DB's SqlClient (provided by AuditLogLive / AuditLogMemory). */
export const KnowledgeStoreLive = Layer.effect(KnowledgeStore, make);

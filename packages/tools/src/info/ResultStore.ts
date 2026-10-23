/**
 * Tanya Data storage in the audit SQLite DB: query results, the blocks shown
 * in the chat, and favorite questions.
 *
 * Query results are kept so `tampilkan` shows exactly the rows the database
 * returned (the AI never copies data into a chart), with the SQL that ran.
 */
import type { DocumentInfo, Favorite, FieldSource, FormDraft, RenderBlock, RenderType } from "@simha/shared";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

export type Row = Readonly<Record<string, unknown>>;

export interface QueryResult {
  readonly id: string;
  readonly sessionId: string | null;
  readonly reason: string;
  /** The SELECT as written (what a favorite re-runs). */
  readonly sqlOriginal: string;
  /** The SELECT that ran, with the added LIMIT. */
  readonly sqlFinal: string;
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<Row>;
  readonly truncated: boolean;
}

export interface StoredBlock {
  readonly block: RenderBlock;
  readonly sessionId: string | null;
  /** The question of the agent run that showed the block, if any. */
  readonly question: string | null;
}

type NewFavorite = Omit<Favorite, "id" | "createdAt">;

const now = () => new Date().toISOString();

interface DraftRow {
  readonly id: string;
  readonly form: string;
  readonly no_rawat: string;
  readonly subject: string;
  readonly existing: number;
  readonly fields_json: string;
  readonly sources_json: string;
  readonly created_by: string | null;
  readonly updated_at: string;
}

interface FavoriteRow {
  readonly id: string;
  readonly question: string;
  readonly title: string;
  readonly sql: string;
  readonly render_type: RenderType;
  readonly options_json: string;
  readonly assumptions: string | null;
  readonly created_by: string;
  readonly created_at: string;
}

const toFavorite = (r: FavoriteRow): Favorite => ({
  id: r.id,
  question: r.question,
  judul: r.title,
  sql: r.sql,
  tipe: r.render_type,
  opsi: JSON.parse(r.options_json) as Favorite["opsi"],
  asumsi: r.assumptions,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export interface DocumentRow {
  readonly id: string;
  readonly kind: DocumentInfo["jenis"];
  readonly title: string;
  readonly subject: string;
  readonly summary: string;
  readonly actor: string | null;
  readonly created_at: string;
}

export const toDocumentInfo = (r: DocumentRow): DocumentInfo => ({
  id: r.id,
  jenis: r.kind,
  judul: r.title,
  subjek: r.subject,
  ringkas: r.summary,
  dibuatOleh: r.actor,
  dibuatPada: r.created_at,
});

const toDraft = (r: DraftRow): FormDraft => ({
  id: r.id,
  form: r.form as FormDraft["form"],
  noRawat: r.no_rawat,
  subjek: r.subject,
  existing: r.existing === 1,
  fields: JSON.parse(r.fields_json) as Record<string, string>,
  sources: JSON.parse(r.sources_json) as Record<string, FieldSource>,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const saveResult = (input: Omit<QueryResult, "id"> & { readonly toolCallId: string | null }) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID();
      yield* sql`INSERT INTO query_results ${sql.insert({
        id,
        tool_call_id: input.toolCallId,
        session_id: input.sessionId,
        reason: input.reason,
        sql_original: input.sqlOriginal,
        sql_final: input.sqlFinal,
        columns_json: JSON.stringify(input.columns),
        rows_json: JSON.stringify(input.rows),
        row_count: input.rows.length,
        truncated: input.truncated ? 1 : 0,
        created_at: now(),
      })}`;
      return id;
    }).pipe(Effect.orDie);

  const getResult = (id: string) =>
    sql<{
      id: string;
      session_id: string | null;
      reason: string;
      sql_original: string;
      sql_final: string;
      columns_json: string;
      rows_json: string;
      truncated: number;
    }>`SELECT * FROM query_results WHERE id = ${id}`.pipe(
      Effect.map(([r]): QueryResult | undefined =>
        r
          ? {
              id: r.id,
              sessionId: r.session_id,
              reason: r.reason,
              sqlOriginal: r.sql_original,
              sqlFinal: r.sql_final,
              columns: JSON.parse(r.columns_json) as ReadonlyArray<string>,
              rows: JSON.parse(r.rows_json) as ReadonlyArray<Row>,
              truncated: r.truncated === 1,
            }
          : undefined,
      ),
      Effect.orDie,
    );

  const saveBlock = (block: RenderBlock, origin: { readonly toolCallId: string | null; readonly sessionId: string | null }) =>
    sql`INSERT INTO render_blocks ${sql.insert({
      id: block.id,
      query_id: block.queryId,
      tool_call_id: origin.toolCallId,
      session_id: origin.sessionId,
      block_json: JSON.stringify(block),
      created_at: now(),
    })}`.pipe(Effect.asVoid, Effect.orDie);

  const getBlock = (id: string) =>
    sql<{ block_json: string; session_id: string | null; question: string | null }>`
      SELECT b.block_json, b.session_id, r.question
      FROM render_blocks b LEFT JOIN agent_runs r ON r.id = b.session_id
      WHERE b.id = ${id}`.pipe(
      Effect.map(([r]): StoredBlock | undefined =>
        r ? { block: JSON.parse(r.block_json) as RenderBlock, sessionId: r.session_id, question: r.question } : undefined,
      ),
      Effect.orDie,
    );

  /** Failed calls of `tool` in a session since its last successful call. */
  const failuresSinceSuccess = (sessionId: string, tool: string) =>
    sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM tool_calls
      WHERE session_id = ${sessionId} AND tool = ${tool} AND status = 'error'
        AND started_at > COALESCE(
          (SELECT MAX(started_at) FROM tool_calls WHERE session_id = ${sessionId} AND tool = ${tool} AND status = 'ok'),
          '')`.pipe(
      Effect.map(([r]) => r?.n ?? 0),
      Effect.orDie,
    );

  const listFavorites = sql<FavoriteRow>`SELECT * FROM favorites ORDER BY created_at DESC`.pipe(
    Effect.map((rows) => rows.map(toFavorite)),
    Effect.orDie,
  );

  const getFavorite = (id: string) =>
    sql<FavoriteRow>`SELECT * FROM favorites WHERE id = ${id}`.pipe(
      Effect.map(([r]) => (r ? toFavorite(r) : undefined)),
      Effect.orDie,
    );

  const createFavorite = (input: NewFavorite) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID();
      yield* sql`INSERT INTO favorites ${sql.insert({
        id,
        question: input.question,
        title: input.judul,
        sql: input.sql,
        render_type: input.tipe,
        options_json: JSON.stringify(input.opsi),
        assumptions: input.asumsi,
        created_by: input.createdBy,
        created_at: now(),
      })}`;
      return (yield* getFavorite(id)) as Favorite;
    }).pipe(Effect.orDie);

  const deleteFavorite = (id: string) =>
    sql<{ id: string }>`DELETE FROM favorites WHERE id = ${id} RETURNING id`.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.orDie,
    );

  const saveDocument = (
    info: DocumentInfo,
    html: string,
    origin: { readonly toolCallId: string | null; readonly sessionId: string | null },
  ) =>
    sql`INSERT INTO documents ${sql.insert({
      id: info.id,
      kind: info.jenis,
      title: info.judul,
      subject: info.subjek,
      summary: info.ringkas,
      session_id: origin.sessionId,
      tool_call_id: origin.toolCallId,
      actor: info.dibuatOleh,
      html,
      created_at: info.dibuatPada,
    })}`.pipe(Effect.asVoid, Effect.orDie);

  const getDocument = (id: string) =>
    sql<DocumentRow & { html: string }>`SELECT * FROM documents WHERE id = ${id}`.pipe(
      Effect.map(([r]) => (r ? { info: toDocumentInfo(r), html: r.html } : undefined)),
      Effect.orDie,
    );

  const saveDraft = (draft: FormDraft, origin: { readonly toolCallId: string | null; readonly sessionId: string | null }) =>
    sql`INSERT INTO form_drafts ${sql.insert({
      id: draft.id,
      form: draft.form,
      no_rawat: draft.noRawat,
      subject: draft.subjek,
      existing: draft.existing ? 1 : 0,
      fields_json: JSON.stringify(draft.fields),
      sources_json: JSON.stringify(draft.sources),
      session_id: origin.sessionId,
      tool_call_id: origin.toolCallId,
      created_by: draft.createdBy,
      created_at: draft.updatedAt,
      updated_by: draft.createdBy,
      updated_at: draft.updatedAt,
    })}`.pipe(Effect.asVoid, Effect.orDie);

  const getDraft = (id: string) =>
    sql<DraftRow>`SELECT * FROM form_drafts WHERE id = ${id}`.pipe(
      Effect.map(([r]) => (r ? toDraft(r) : undefined)),
      Effect.orDie,
    );

  /** Sets some fields (empty string = clear) and records where they came from. */
  const updateDraft = (id: string, values: Readonly<Record<string, string>>, source: FieldSource, actor: string | null) =>
    Effect.gen(function* () {
      const draft = yield* getDraft(id);
      if (!draft) return undefined;
      const fields = { ...draft.fields, ...values };
      const sources = { ...draft.sources };
      for (const [key, value] of Object.entries(values)) {
        if (value === "") delete sources[key];
        else sources[key] = source;
      }
      const updatedAt = now();
      yield* sql`UPDATE form_drafts SET fields_json = ${JSON.stringify(fields)}, sources_json = ${JSON.stringify(sources)},
        updated_by = ${actor}, updated_at = ${updatedAt} WHERE id = ${id}`;
      return { ...draft, fields, sources, updatedAt } satisfies FormDraft;
    }).pipe(Effect.orDie);

  return {
    saveDraft,
    getDraft,
    updateDraft,
    saveDocument,
    getDocument,
    saveResult,
    getResult,
    saveBlock,
    getBlock,
    failuresSinceSuccess,
    listFavorites,
    getFavorite,
    createFavorite,
    deleteFavorite,
  };
});

export class ResultStore extends Context.Service<ResultStore, Effect.Success<typeof make>>()("simha/ResultStore") {}

/** Needs the audit DB's SqlClient (provided by AuditLogLive / AuditLogMemory). */
export const ResultStoreLive = Layer.effect(ResultStore, make);

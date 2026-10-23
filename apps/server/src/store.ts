/**
 * Tickets, conversations and agent runs, stored in the audit SQLite DB.
 */
import type { ChatMessage } from "@simrs/llm";
import type { CreateTicketRequest, Ticket, TicketStatus } from "@simrs/shared";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

interface RunStart {
  readonly id: string;
  readonly conversationId: string;
  readonly ticketId: string | null;
  readonly kind: "ask" | "ticket";
  readonly question: string;
  /** Username of the IT staff member who asked. */
  readonly askedBy: string | null;
  readonly provider: string;
  readonly model: string;
  readonly maskPii: boolean;
}

interface RunEnd {
  readonly id: string;
  readonly status: "ok" | "error" | "interrupted";
  readonly finalText: string | null;
  readonly stopReason: string | null;
  readonly steps: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Input tokens served from the provider's prompt cache (part of inputTokens). */
  readonly cachedInputTokens: number | null;
  /** Input tokens written to the prompt cache on this run. */
  readonly cacheWriteTokens: number | null;
  readonly error: string | null;
}

interface TicketRow {
  readonly id: string;
  readonly nurse_name: string;
  readonly unit: string;
  readonly complaint: string;
  readonly status: TicketStatus;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id,
  createdBy: r.created_by,
  nurseName: r.nurse_name,
  unit: r.unit,
  complaint: r.complaint,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const now = () => new Date().toISOString();

/**
 * Store failures are bugs or a broken disk, not something a user can fix,
 * so they are defects. That also means nothing continues without its audit row.
 */
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const createTicket = (input: CreateTicketRequest, createdBy: string) =>
    Effect.gen(function* () {
      const ticket: Ticket = {
        id: crypto.randomUUID(),
        createdBy,
        ...input,
        status: "open",
        createdAt: now(),
        updatedAt: now(),
      };
      yield* sql`INSERT INTO tickets ${sql.insert({
        id: ticket.id,
        nurse_name: ticket.nurseName,
        unit: ticket.unit,
        complaint: ticket.complaint,
        status: ticket.status,
        created_by: createdBy,
        created_at: ticket.createdAt,
        updated_at: ticket.updatedAt,
      })}`;
      return ticket;
    }).pipe(Effect.orDie);

  const getTicket = (id: string) =>
    sql<TicketRow>`SELECT * FROM tickets WHERE id = ${id}`.pipe(
      Effect.map((rows) => (rows[0] ? toTicket(rows[0]) : undefined)),
      Effect.orDie,
    );

  const listTickets = sql<TicketRow>`SELECT * FROM tickets ORDER BY created_at DESC LIMIT 200`.pipe(
    Effect.map((rows) => rows.map(toTicket)),
    Effect.orDie,
  );

  const setTicketStatus = (id: string, status: TicketStatus) =>
    sql`UPDATE tickets SET status = ${status}, updated_at = ${now()} WHERE id = ${id}`.pipe(Effect.asVoid, Effect.orDie);

  /** The conversation of a ticket, or of an ask thread; created when missing. */
  const conversationFor = (options: { readonly kind: "ask" | "ticket"; readonly id?: string; readonly ticketId?: string }) =>
    Effect.gen(function* () {
      const existing = options.ticketId
        ? yield* sql<{ id: string }>`SELECT id FROM conversations WHERE ticket_id = ${options.ticketId} AND deleted_at IS NULL`
        : options.id
          ? yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${options.id} AND kind = ${options.kind} AND deleted_at IS NULL`
          : [];
      if (existing[0]) return existing[0].id;
      const id = crypto.randomUUID();
      yield* sql`INSERT INTO conversations ${sql.insert({
        id,
        kind: options.kind,
        ticket_id: options.ticketId ?? null,
        created_at: now(),
      })}`;
      return id;
    }).pipe(Effect.orDie);

  const loadMessages = (conversationId: string) =>
    sql<{ message_json: string }>`
      SELECT message_json FROM conversation_messages WHERE conversation_id = ${conversationId} ORDER BY id`.pipe(
      Effect.map((rows) => rows.map((r) => JSON.parse(r.message_json) as ChatMessage)),
      Effect.orDie,
    );

  const appendMessage = (conversationId: string, runId: string, message: ChatMessage) =>
    sql`INSERT INTO conversation_messages ${sql.insert({
      conversation_id: conversationId,
      run_id: runId,
      role: message.role,
      message_json: JSON.stringify(message),
      created_at: now(),
    })}`.pipe(Effect.asVoid, Effect.orDie);

  /** Who asked the thread's first question; undefined when it is missing or removed. */
  const conversationOwner = (id: string) =>
    sql<{ asked_by: string | null }>`
      SELECT (SELECT asked_by FROM agent_runs WHERE conversation_id = c.id ORDER BY started_at LIMIT 1) AS asked_by
      FROM conversations c WHERE c.id = ${id} AND c.kind = 'ask' AND c.deleted_at IS NULL`.pipe(
      Effect.map((rows) => (rows[0] ? rows[0].asked_by : undefined)),
      Effect.orDie,
    );

  /** Pins or archives a thread; false when it no longer exists. */
  const setConversationFlags = (id: string, flags: { readonly pinned?: boolean; readonly archived?: boolean }) =>
    Effect.gen(function* () {
      const at = now();
      const updates: Record<string, string | null> = {};
      if (flags.pinned !== undefined) updates["pinned_at"] = flags.pinned ? at : null;
      if (flags.archived !== undefined) updates["archived_at"] = flags.archived ? at : null;
      if (Object.keys(updates).length === 0) return true;
      const rows = yield* sql<{ id: string }>`
        UPDATE conversations SET ${sql.update(updates)}
        WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
      return rows.length === 1;
    }).pipe(Effect.orDie);

  /**
   * Removes a thread from every list and deletes its messages, so the AI cannot
   * use it as context again. The audit log keeps the runs (they are the audit
   * trail), but the conversation itself is unreachable.
   */
  const removeConversation = (id: string) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ id: string }>`
            UPDATE conversations SET deleted_at = ${now()}, pinned_at = NULL, archived_at = NULL
            WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
          if (rows.length === 0) return false;
          yield* sql`DELETE FROM conversation_messages WHERE conversation_id = ${id}`;
          return true;
        }),
      )
      .pipe(Effect.orDie);

  const runStarted = (run: RunStart) =>
    sql`INSERT INTO agent_runs ${sql.insert({
      id: run.id,
      conversation_id: run.conversationId,
      ticket_id: run.ticketId,
      kind: run.kind,
      question: run.question,
      asked_by: run.askedBy,
      provider: run.provider,
      model: run.model,
      mask_pii: run.maskPii ? 1 : 0,
      status: "running",
      started_at: now(),
    })}`.pipe(Effect.asVoid, Effect.orDie);

  const runFinished = (run: RunEnd) =>
    sql`UPDATE agent_runs SET ${sql.update({
      status: run.status,
      final_text: run.finalText,
      stop_reason: run.stopReason,
      steps: run.steps,
      input_tokens: run.inputTokens,
      output_tokens: run.outputTokens,
      cached_input_tokens: run.cachedInputTokens,
      cache_write_tokens: run.cacheWriteTokens,
      error: run.error,
      finished_at: now(),
    })} WHERE id = ${run.id}`.pipe(Effect.asVoid, Effect.orDie);

  /** A finished answer, for run-level 👍/👎 knowledge feedback. */
  const getRun = (id: string) =>
    sql<{ question: string; final_text: string | null; asked_by: string | null }>`
      SELECT question, final_text, asked_by FROM agent_runs WHERE id = ${id}`.pipe(
      Effect.map(([r]) => r),
      Effect.orDie,
    );

  return {
    createTicket,
    getTicket,
    listTickets,
    setTicketStatus,
    conversationFor,
    loadMessages,
    appendMessage,
    conversationOwner,
    setConversationFlags,
    removeConversation,
    runStarted,
    runFinished,
    getRun,
  };
});

export class Store extends Context.Service<Store, Effect.Success<typeof make>>()("simrs/Store") {}

/** Needs the audit DB's SqlClient (provided by AuditLogLive / AuditLogMemory). */
export const StoreLive = Layer.effect(Store, make);

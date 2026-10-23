/**
 * The agent loop, identical for every AI provider:
 *
 *   send history + tools -> stream text -> run the requested tools through
 *   runTool (Schema check, audit log) -> mask the results -> send them back
 *   -> repeat until the model answers without tools (max MAX_STEPS turns).
 *
 * It only uses the neutral LlmClient interface, so guards, audit logging and
 * streaming behave the same for Claude, OpenAI-compatible servers and the
 * fake test adapter.
 */
import { LlmClient, type ChatMessage, type LlmEvent, type ToolCall } from "@simrs/llm";
import type { AgentEvent, DocumentInfo, FormDraft, RadiologyGallery, RenderBlock, Ticket } from "@simrs/shared";
import {
  AuditLog,
  defaultRegistry,
  FixStore,
  KhanzaRead,
  KnowledgeStore,
  maskPii,
  maskText,
  Pacs,
  personalReason,
  ResultStore,
  runTool,
  AppDocs,
  SchemaDocs,
  type ToolRegistry,
} from "@simrs/tools";
import { Cause, Context, Effect, Exit, Layer, Queue, Stream } from "effect";
import { Store } from "../store.ts";
import { knowledgePrompt, withKnowledge } from "./knowledge.ts";
import { SystemPrompt } from "./prompt.ts";

/** Upper bound on model turns per question, so a confused model cannot loop forever. */
export const MAX_STEPS = 12;

type AgentInput = (
  | { readonly kind: "ask"; readonly question: string; readonly conversationId?: string | undefined }
  | { readonly kind: "ticket"; readonly ticket: Ticket; readonly question?: string | undefined }
) & {
  /** Username of the IT staff member asking (audit log). */
  readonly askedBy: string | null;
};

/**
 * Server clock and the newest registration date in Khanza, given to the model
 * so "hari ini" and "7 hari terakhir" mean the right dates. Without the data
 * date, a model on an old or test database queries today's date, gets 0 rows,
 * and spends extra turns finding where the data ends.
 */
const contextLine = (now: Date, latestData: string | null): string => {
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" }).format(now);
  const data = latestData ? `; data registrasi terakhir di database: ${latestData}` : "";
  return `[Waktu server: ${date}; ${now.toISOString().slice(0, 10)}${data}]`;
};

/** The user turn sent to the model for a question or a ticket. */
const userText = (input: AgentInput, now: Date, latestData: string | null): string => {
  const context = contextLine(now, latestData);
  if (input.kind === "ask") return `${context}\n${input.question}`;
  if (input.question !== undefined) return `${context}\nPertanyaan lanjutan tentang tiket ini: ${input.question}`;
  const t = input.ticket;
  return [
    context,
    `Tiket dari perawat ${t.nurseName} (unit ${t.unit}), dibuat ${t.createdAt}:`,
    `"${t.complaint}"`,
    "Selidiki keluhan ini dengan data Khanza, lalu berikan diagnosis dan saran perbaikan.",
  ].join("\n");
};

/** What the model sees from a tool: masked when the provider requires it. */
const toolContent = (value: unknown, mask: boolean): string => JSON.stringify(mask ? maskPii(value) : value);

const errorMessage = (cause: Cause.Cause<unknown>): string => {
  const failure = cause.reasons.find((r) => r._tag === "Fail");
  if (failure?._tag === "Fail") {
    const error = failure.error;
    return error instanceof Error ? error.message : String(error);
  }
  return "Terjadi kesalahan internal pada tool.";
};

const make = Effect.gen(function* () {
  const llm = yield* LlmClient;
  const read = yield* KhanzaRead;
  const audit = yield* AuditLog;
  const store = yield* Store;
  const fixes = yield* FixStore;
  const results = yield* ResultStore;
  const knowledge = yield* KnowledgeStore;
  const docs = yield* SchemaDocs;
  const appDocs = yield* AppDocs;
  const pacs = yield* Pacs;
  const system = yield* SystemPrompt;
  const registry: ToolRegistry = defaultRegistry;

  /** Newest reg_periksa date, cached for a few minutes; null when it cannot be read. */
  const LATEST_DATA_TTL_MS = 5 * 60_000;
  let latestDataCache: { readonly value: string | null; readonly at: number } | undefined;
  const latestDataDate = Effect.gen(function* () {
    const now = Date.now();
    if (latestDataCache && now - latestDataCache.at < LATEST_DATA_TTL_MS) return latestDataCache.value;
    const rows = yield* read.query<{ readonly d: unknown }>(
      (sql) => sql`SELECT DATE_FORMAT(MAX(tgl_registrasi), '%Y-%m-%d') AS d FROM reg_periksa`,
    );
    const d = rows[0]?.d;
    const value = typeof d === "string" && d !== "" ? d : null;
    latestDataCache = { value, at: now };
    return value;
  }).pipe(Effect.catch(() => Effect.succeed(null)));

  const runOneTool = (call: ToolCall, runId: string, askedBy: string | null) =>
    Effect.gen(function* () {
      const tool = registry.get(call.name);
      const started = performance.now();
      if (tool === undefined) {
        const known = registry.tools.map((t) => t.name).join(", ");
        return { ok: false as const, error: `Tool "${call.name}" tidak ada. Tool yang tersedia: ${known}.`, durationMs: 0 };
      }
      const exit = yield* runTool(tool, call.args, { sessionId: runId, actor: askedBy }).pipe(
        Effect.provideService(KhanzaRead, read),
        Effect.provideService(AuditLog, audit),
        Effect.provideService(FixStore, fixes),
        Effect.provideService(ResultStore, results),
        Effect.provideService(KnowledgeStore, knowledge),
        Effect.provideService(SchemaDocs, docs),
        Effect.provideService(AppDocs, appDocs),
        Effect.provideService(Pacs, pacs),
        Effect.exit,
      );
      const durationMs = performance.now() - started;
      if (!Exit.isSuccess(exit)) return { ok: false as const, error: errorMessage(exit.cause), durationMs };
      const result = exit.value;
      return {
        ok: true as const,
        result,
        forModel: tool.forModel ? tool.forModel(result) : result,
        block: tool.kind === "render" ? (result as { readonly block?: RenderBlock }).block : undefined,
        document: tool.kind === "render" ? (result as { readonly document?: DocumentInfo }).document : undefined,
        draft: tool.kind === "render" ? (result as { readonly draft?: FormDraft }).draft : undefined,
        gallery: tool.kind === "render" ? (result as { readonly gallery?: RadiologyGallery }).gallery : undefined,
        durationMs,
      };
    });

  /** Runs one question or ticket investigation and streams its events. */
  const run = (input: AgentInput): Stream.Stream<AgentEvent> =>
    Stream.callback<AgentEvent>((queue) =>
      Effect.gen(function* () {
        const emit = (event: AgentEvent) => Queue.offer(queue, event);
        const ticketId = input.kind === "ticket" ? input.ticket.id : null;
        const conversationId = yield* store.conversationFor(
          input.kind === "ticket" ? { kind: "ticket", ticketId: input.ticket.id } : { kind: "ask", ...(input.conversationId ? { id: input.conversationId } : {}) },
        );
        const runId = crypto.randomUUID();
        const { info } = llm;
        const question =
          input.kind === "ask" ? input.question : (input.question ?? `Investigasi tiket: ${input.ticket.complaint}`);

        yield* store.runStarted({
          id: runId,
          conversationId,
          ticketId,
          kind: input.kind,
          question,
          askedBy: input.askedBy,
          provider: info.provider,
          model: info.model,
          maskPii: info.maskPii,
        });
        if (input.kind === "ticket") yield* store.setTicketStatus(input.ticket.id, "investigating");
        yield* emit({ _tag: "run_started", runId, conversationId, provider: info.provider, model: info.model });

        const history: Array<ChatMessage> = [...(yield* store.loadMessages(conversationId))];
        const followUp = history.length > 0;
        const append = (message: ChatMessage) =>
          store.appendMessage(conversationId, runId, message).pipe(
            Effect.map(() => {
              history.push(message);
            }),
          );

        const raw = userText(input, new Date(), yield* latestDataDate);
        yield* append({ role: "user", text: info.maskPii ? maskText(raw) : raw });
        const userMessageIndex = history.length - 1;
        // What earlier questions taught us. The stored message stays plain; the
        // block is only added to the requests, so follow-ups do not replay it.
        const matches = yield* knowledge.relevant(question).pipe(Effect.catchCause(() => Effect.succeed([])));
        const learned = knowledgePrompt(matches);
        const knowledgeBlock = learned === "" ? "" : info.maskPii ? maskText(learned) : learned;

        let steps = 0;
        let finalText = "";
        let stopReason = "other";
        let inputTokens = 0;
        let outputTokens = 0;
        const blocks: Array<RenderBlock> = [];

        const loop = Effect.gen(function* () {
          while (steps < MAX_STEPS) {
            steps++;
            let text = "";
            const calls: Array<ToolCall> = [];
            let done: Extract<LlmEvent, { type: "done" }> | undefined;
            // Tool calls streamed while being written, in order; the n-th
            // finished call replaces the n-th draft in the UI.
            const drafts: Array<{ readonly index: number; readonly draftId: string }> = [];
            yield* llm.chat({
              system,
              messages: withKnowledge(history, userMessageIndex, knowledgeBlock),
              tools: registry.descriptions,
            }).pipe(
              Stream.runForEach((event) => {
                switch (event.type) {
                  case "text_delta":
                    text += event.text;
                    return emit({ _tag: "text_delta", text: event.text });
                  case "reasoning_delta":
                    return emit({ _tag: "reasoning_delta", text: event.text });
                  case "tool_input_delta": {
                    let draft = drafts.find((d) => d.index === event.index);
                    if (draft === undefined) {
                      draft = { index: event.index, draftId: `${runId}:${steps}:${event.index}` };
                      drafts.push(draft);
                    }
                    return emit({ _tag: "tool_input_delta", draftId: draft.draftId, name: event.name, delta: event.delta });
                  }
                  case "tool_call":
                    calls.push(event.call);
                    return Effect.void;
                  case "done":
                    done = event;
                    return Effect.void;
                }
              }),
            );
            stopReason = done?.stopReason ?? "other";
            inputTokens += done?.usage?.inputTokens ?? 0;
            outputTokens += done?.usage?.outputTokens ?? 0;
            yield* append({ role: "assistant", text, toolCalls: calls, native: done?.native });
            if (text.trim() !== "") finalText = text;

            if (stopReason !== "tool_use" || calls.length === 0) return;

            for (const [n, call] of calls.entries()) {
              const draftId = drafts.toSorted((a, b) => a.index - b.index)[n]?.draftId;
              yield* emit({ _tag: "tool_started", callId: call.id, name: call.name, args: call.args, ...(draftId ? { draftId } : {}) });
              const outcome = yield* runOneTool(call, runId, input.askedBy);
              yield* emit(
                outcome.ok
                  ? { _tag: "tool_finished", callId: call.id, name: call.name, ok: true, result: outcome.result, durationMs: outcome.durationMs }
                  : { _tag: "tool_finished", callId: call.id, name: call.name, ok: false, error: outcome.error, durationMs: outcome.durationMs },
              );
              if (outcome.ok && outcome.block) {
                blocks.push(outcome.block);
                yield* emit({ _tag: "render", callId: call.id, block: outcome.block });
              }
              if (outcome.ok && outcome.document) yield* emit({ _tag: "document", callId: call.id, document: outcome.document });
              if (outcome.ok && outcome.draft) yield* emit({ _tag: "draft", callId: call.id, draft: outcome.draft });
              if (outcome.ok && outcome.gallery) yield* emit({ _tag: "radiology", callId: call.id, gallery: outcome.gallery });
              yield* append({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: outcome.ok ? toolContent(outcome.forModel, info.maskPii) : outcome.error,
                isError: !outcome.ok,
              });
            }
          }
          stopReason = "max_steps";
          finalText ||= `Berhenti setelah ${MAX_STEPS} langkah tanpa jawaban akhir.`;
        });

        /** A successful, self-contained question with a result is worth reusing. */
        const saveKnowledge = Effect.gen(function* () {
          if (input.kind !== "ask" || followUp || blocks.length === 0) return;
          const block = blocks[0];
          if (block === undefined) return;
          if (personalReason(question) !== null) return;
          const result = yield* results.getResult(block.queryId);
          const sql = result?.sqlOriginal ?? block.sql;
          if (personalReason(sql) !== null) return;
          if (yield* knowledge.hasExample(question)) return;
          yield* knowledge.add({
            kind: "example",
            source: "auto",
            text: question,
            sql,
            renderType: block.tipe,
            title: block.judul,
            verified: false,
            blockId: block.id,
            runId,
            createdBy: input.askedBy,
          });
        }).pipe(Effect.catchCause(() => Effect.void));

        const finish = (status: "ok" | "error" | "interrupted", error: string | null) =>
          Effect.asVoid(Effect.all([
            store.runFinished({
              id: runId,
              status,
              finalText: finalText || null,
              stopReason,
              steps,
              inputTokens: inputTokens || null,
              outputTokens: outputTokens || null,
              error,
            }),
            ticketId === null ? Effect.void : store.setTicketStatus(ticketId, status === "ok" ? "diagnosed" : "open"),
          ]));

        yield* loop.pipe(
          Effect.matchCauseEffect({
            onSuccess: () =>
              Effect.andThen(finish("ok", null), saveKnowledge).pipe(
                Effect.andThen(emit({ _tag: "done", runId, text: finalText, stopReason, steps })),
                Effect.asVoid,
              ),
            onFailure: (cause) => {
              if (Cause.hasInterruptsOnly(cause)) return finish("interrupted", "Dibatalkan oleh pengguna.");
              const message = errorMessage(cause);
              return Effect.andThen(finish("error", message), emit({ _tag: "error", message })).pipe(Effect.asVoid);
            },
          }),
          Effect.onInterrupt(() => finish("interrupted", "Koneksi ditutup sebelum selesai.")),
        );
        yield* Queue.end(queue);
      }),
    );

  return { run };
});

export class Agent extends Context.Service<Agent, Effect.Success<typeof make>>()("simrs/Agent") {}

export const AgentLive = Layer.effect(Agent, make);

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
import type { AgentEvent, Ticket } from "@simrs/shared";
import { AuditLog, defaultRegistry, FixStore, KhanzaRead, maskPii, maskText, runTool, type ToolRegistry } from "@simrs/tools";
import { Cause, Context, Effect, Exit, Layer, Queue, Stream } from "effect";
import { Store } from "../store.ts";
import { SystemPrompt } from "./prompt.ts";

/** Upper bound on model turns per question, so a confused model cannot loop forever. */
export const MAX_STEPS = 12;

type AgentInput =
  | { readonly kind: "ask"; readonly question: string; readonly conversationId?: string | undefined }
  | { readonly kind: "ticket"; readonly ticket: Ticket; readonly question?: string | undefined };

/** Server clock, given to the model so "hari ini" and "minggu ini" mean the right dates. */
const contextLine = (now: Date): string => {
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" }).format(now);
  return `[Waktu server: ${date}; ${now.toISOString().slice(0, 10)}]`;
};

/** The user turn sent to the model for a question or a ticket. */
const userText = (input: AgentInput, now: Date): string => {
  if (input.kind === "ask") return `${contextLine(now)}\n${input.question}`;
  if (input.question !== undefined) return `${contextLine(now)}\nPertanyaan lanjutan tentang tiket ini: ${input.question}`;
  const t = input.ticket;
  return [
    contextLine(now),
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
  const system = yield* SystemPrompt;
  const registry: ToolRegistry = defaultRegistry;

  const runOneTool = (call: ToolCall, runId: string) =>
    Effect.gen(function* () {
      const tool = registry.get(call.name);
      const started = performance.now();
      if (tool === undefined) {
        const known = registry.tools.map((t) => t.name).join(", ");
        return { ok: false as const, error: `Tool "${call.name}" tidak ada. Tool yang tersedia: ${known}.`, durationMs: 0 };
      }
      const exit = yield* runTool(tool, call.args, { sessionId: runId }).pipe(
        Effect.provideService(KhanzaRead, read),
        Effect.provideService(AuditLog, audit),
        Effect.provideService(FixStore, fixes),
        Effect.exit,
      );
      const durationMs = performance.now() - started;
      return Exit.isSuccess(exit)
        ? { ok: true as const, result: exit.value, durationMs }
        : { ok: false as const, error: errorMessage(exit.cause), durationMs };
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
          provider: info.provider,
          model: info.model,
          maskPii: info.maskPii,
        });
        if (input.kind === "ticket") yield* store.setTicketStatus(input.ticket.id, "investigating");
        yield* emit({ _tag: "run_started", runId, conversationId, provider: info.provider, model: info.model });

        const history: Array<ChatMessage> = [...(yield* store.loadMessages(conversationId))];
        const append = (message: ChatMessage) =>
          store.appendMessage(conversationId, runId, message).pipe(
            Effect.map(() => {
              history.push(message);
            }),
          );

        const raw = userText(input, new Date());
        yield* append({ role: "user", text: info.maskPii ? maskText(raw) : raw });

        let steps = 0;
        let finalText = "";
        let stopReason = "other";
        let inputTokens = 0;
        let outputTokens = 0;

        const loop = Effect.gen(function* () {
          while (steps < MAX_STEPS) {
            steps++;
            let text = "";
            const calls: Array<ToolCall> = [];
            let done: Extract<LlmEvent, { type: "done" }> | undefined;
            yield* llm.chat({ system, messages: [...history], tools: registry.descriptions }).pipe(
              Stream.runForEach((event) => {
                switch (event.type) {
                  case "text_delta":
                    text += event.text;
                    return emit({ _tag: "text_delta", text: event.text });
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

            for (const call of calls) {
              yield* emit({ _tag: "tool_started", callId: call.id, name: call.name, args: call.args });
              const outcome = yield* runOneTool(call, runId);
              yield* emit(
                outcome.ok
                  ? { _tag: "tool_finished", callId: call.id, name: call.name, ok: true, result: outcome.result, durationMs: outcome.durationMs }
                  : { _tag: "tool_finished", callId: call.id, name: call.name, ok: false, error: outcome.error, durationMs: outcome.durationMs },
              );
              yield* append({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: outcome.ok ? toolContent(outcome.result, info.maskPii) : outcome.error,
                isError: !outcome.ok,
              });
            }
          }
          stopReason = "max_steps";
          finalText ||= `Berhenti setelah ${MAX_STEPS} langkah tanpa jawaban akhir.`;
        });

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
              Effect.andThen(finish("ok", null), emit({ _tag: "done", runId, text: finalText, stopReason, steps })).pipe(
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

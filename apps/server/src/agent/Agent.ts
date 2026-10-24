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
import { LlmClient, type ChatMessage, type LlmEvent, type ToolCall } from "@simha/llm";
import type { AgentEvent, AgentMode, BerkasDigital, DocumentInfo, FormDraft, Permissions, RadiologyGallery, RenderBlock } from "@simha/shared";
import {
  AuditLog,
  defaultRegistry,
  FixStore,
  KhanzaRead,
  KnowledgeStore,
  makeRegistry,
  maskPii,
  maskText,
  Pacs,
  personalReason,
  ResultStore,
  runTool,
  toolAllowed,
  AppDocs,
  Berkas,
  SchemaDocs,
  type ToolRegistry,
} from "@simha/tools";
import { Cause, Context, Effect, Exit, Layer, Queue, Stream } from "effect";
import { Store } from "../store.ts";
import { compactHistory, HISTORY_TOKEN_BUDGET } from "./history.ts";
import { knowledgePrompt, userTurn } from "./knowledge.ts";
import { SystemPrompt } from "./prompt.ts";

/** Upper bound on model turns per question, including the forced final answer. */
export const MAX_STEPS = 8;

/** After this, the model gets one last turn without tools to answer with what it has. */
const TIME_BUDGET_MS = 45_000;

/** The tools this SIMRS account may use, in the order the provider receives them. */
const registryFor = (permissions: Permissions): ToolRegistry =>
  makeRegistry(defaultRegistry.tools.filter((tool) => toolAllowed(tool, permissions)));

type AgentInput = {
  readonly question: string;
  /** tanya (Tanya Data) or investigasi (a nurse's complaint). */
  readonly mode: AgentMode;
  readonly conversationId?: string | undefined;
  /** Username of the IT staff member asking (audit log). */
  readonly askedBy: string | null;
  /** Snapshot of the SIMRS account's rights; decides which tools the model may see. */
  readonly permissions: Permissions;
};

/** Appended to an investigation question, so the answer has the sections the UI expects. */
const INVESTIGATE_PROMPT = [
  "[Mode: investigasi keluhan]",
  "Selidiki keluhan ini dengan data Khanza. Jawab dengan bagian berikut:",
  "**Yang dicek** – satu baris per pemeriksaan: apa yang dicek dan apa hasilnya.",
  "**Diagnosis** – penyebabnya berdasarkan data. Sebutkan tingkat keyakinan bila data belum cukup.",
  '**Saran perbaikan** – apa yang harus diubah di data atau dilakukan perawat, atau "Tidak perlu perbaikan data". Bila data harus diubah, usulkan dengan `usulkanPerbaikan` dan sebutkan nomor perbaikannya.',
  "Jangan terus memanggil tool: setelah cukup bukti, berhenti dan tulis jawaban. Bila penyebabnya belum pasti, tetap tulis diagnosis sementara dan data yang masih kurang.",
].join("\n");

/** The last turn, when the step or time budget is used up. Tools are disabled. */
const FINAL_INSTRUCTION = [
  "[Batas waktu/langkah tercapai]",
  "Jangan memanggil tool lagi. Tulis jawaban akhir sekarang dari data yang sudah ada.",
  "Bila penyebabnya belum pasti, tulis temuan yang sudah ada, diagnosis sementara, dan data yang masih kurang.",
].join("\n");

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

/** The user turn sent to the model. */
const userText = (input: AgentInput, now: Date, latestData: string | null): string => {
  const context = contextLine(now, latestData);
  return input.mode === "investigasi"
    ? `${context}\n${INVESTIGATE_PROMPT}\n\nKeluhan:\n${input.question}`
    : `${context}\n${input.question}`;
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
  const berkas = yield* Berkas;
  const system = yield* SystemPrompt;

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

  const runOneTool = (
    registry: ToolRegistry,
    permissions: Permissions,
    call: ToolCall,
    runId: string,
    askedBy: string | null,
  ) =>
    Effect.gen(function* () {
      const tool = registry.get(call.name);
      const started = performance.now();
      if (tool === undefined) {
        const known = registry.tools.map((t) => t.name).join(", ");
        return { ok: false as const, error: `Tool "${call.name}" tidak ada. Tool yang tersedia: ${known}.`, durationMs: 0 };
      }
      const exit = yield* runTool(tool, call.args, { sessionId: runId, actor: askedBy, permissions }).pipe(
        Effect.provideService(KhanzaRead, read),
        Effect.provideService(AuditLog, audit),
        Effect.provideService(FixStore, fixes),
        Effect.provideService(ResultStore, results),
        Effect.provideService(KnowledgeStore, knowledge),
        Effect.provideService(SchemaDocs, docs),
        Effect.provideService(AppDocs, appDocs),
        Effect.provideService(Pacs, pacs),
        Effect.provideService(Berkas, berkas),
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
        berkas: tool.kind === "render" ? (result as { readonly berkas?: BerkasDigital }).berkas : undefined,
        durationMs,
      };
    });

  /** Runs one question or investigation and streams its events. */
  const run = (input: AgentInput): Stream.Stream<AgentEvent> =>
    Stream.callback<AgentEvent>((queue) =>
      Effect.gen(function* () {
        const emit = (event: AgentEvent) => Queue.offer(queue, event);
        const registry = registryFor(input.permissions);
        const conversationId = yield* store.conversationFor(input.conversationId ? { id: input.conversationId } : {});
        const runId = crypto.randomUUID();
        const { info } = llm;
        const question = input.question;

        yield* store.runStarted({
          id: runId,
          conversationId,
          mode: input.mode,
          question,
          askedBy: input.askedBy,
          provider: info.provider,
          model: info.model,
          maskPii: info.maskPii,
        });
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
        // What earlier questions taught us. `text` stays the plain question (it
        // is what the UI shows); the block rides along as `modelText`, so the
        // next question replays exactly what the model saw and the provider's
        // prompt cache keeps its prefix.
        const matches = yield* knowledge.relevant(question).pipe(Effect.catchCause(() => Effect.succeed([])));
        const learned = knowledgePrompt(matches);
        const knowledgeBlock = learned === "" ? "" : info.maskPii ? maskText(learned) : learned;
        yield* append(userTurn(info.maskPii ? maskText(raw) : raw, knowledgeBlock));

        let steps = 0;
        let finalText = "";
        let stopReason = "other";
        let inputTokens = 0;
        let outputTokens = 0;
        let cachedInputTokens = 0;
        let cacheWriteTokens = 0;
        const blocks: Array<RenderBlock> = [];
        const startedAt = Date.now();

        /**
         * One last model turn with no tools, so a slow or confused model still
         * gives an answer instead of ending on "Saya cek dulu…". Returns false
         * when it produces no text; the run then fails instead of pretending.
         */
        const finalTurn = (reason: "time_budget" | "max_steps") =>
          Effect.gen(function* () {
            steps++;
            let text = "";
            let done: Extract<LlmEvent, { type: "done" }> | undefined;
            yield* append({ role: "user", text: FINAL_INSTRUCTION });
            yield* llm.chat({
              system,
              messages: [...compactHistory(history, HISTORY_TOKEN_BUDGET)],
              tools: [],
              cacheKey: conversationId,
            }).pipe(
              Stream.runForEach((event) => {
                if (event.type === "text_delta") {
                  text += event.text;
                  return emit({ _tag: "text_delta", text: event.text });
                }
                if (event.type === "reasoning_delta") return emit({ _tag: "reasoning_delta", text: event.text });
                if (event.type === "done") {
                  done = event;
                  return Effect.void;
                }
                return Effect.void;
              }),
            );
            inputTokens += done?.usage?.inputTokens ?? 0;
            outputTokens += done?.usage?.outputTokens ?? 0;
            cachedInputTokens += done?.usage?.cachedInputTokens ?? 0;
            cacheWriteTokens += done?.usage?.cacheWriteTokens ?? 0;
            yield* append({ role: "assistant", text, toolCalls: [] });
            stopReason = reason;
            if (text.trim() === "") return false;
            finalText = text;
            return true;
          });

        const loop = Effect.gen(function* () {
          while (true) {
            const overTime = Date.now() - startedAt >= TIME_BUDGET_MS;
            if (steps > 0 && (overTime || steps >= MAX_STEPS - 1)) {
              const answered = yield* finalTurn(overTime ? "time_budget" : "max_steps");
              if (!answered) return yield* Effect.fail(new Error("AI tidak memberi jawaban akhir dalam batas waktu."));
              return;
            }

            steps++;
            let text = "";
            const calls: Array<ToolCall> = [];
            let done: Extract<LlmEvent, { type: "done" }> | undefined;
            // Tool calls streamed while being written, in order; the n-th
            // finished call replaces the n-th draft in the UI.
            const drafts: Array<{ readonly index: number; readonly draftId: string }> = [];
            yield* llm.chat({
              system,
              // Budgeted snapshot: old turns are dropped and summarised, the
              // newest kept exactly as stored, and the run keeps appending to
              // `history` while this turn streams.
              messages: [...compactHistory(history, HISTORY_TOKEN_BUDGET)],
              tools: registry.descriptions,
              cacheKey: conversationId,
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
            cachedInputTokens += done?.usage?.cachedInputTokens ?? 0;
            cacheWriteTokens += done?.usage?.cacheWriteTokens ?? 0;
            yield* append({ role: "assistant", text, toolCalls: calls, native: done?.native });
            if (text.trim() !== "") finalText = text;

            if (stopReason !== "tool_use" || calls.length === 0) return;

            for (const [n, call] of calls.entries()) {
              const draftId = drafts.toSorted((a, b) => a.index - b.index)[n]?.draftId;
              yield* emit({ _tag: "tool_started", callId: call.id, name: call.name, args: call.args, ...(draftId ? { draftId } : {}) });
              const outcome = yield* runOneTool(registry, input.permissions, call, runId, input.askedBy);
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
              if (outcome.ok && outcome.berkas) yield* emit({ _tag: "berkas", callId: call.id, berkas: outcome.berkas });
              yield* append({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: outcome.ok ? toolContent(outcome.forModel, info.maskPii) : outcome.error,
                isError: !outcome.ok,
              });
            }
          }
        });

        /** A successful, self-contained question with a result is worth reusing. */
        const saveKnowledge = Effect.gen(function* () {
          if (input.mode !== "tanya" || followUp || blocks.length === 0) return;
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
          Effect.asVoid(
            store.runFinished({
              id: runId,
              status,
              finalText: finalText || null,
              stopReason,
              steps,
              inputTokens: inputTokens || null,
              outputTokens: outputTokens || null,
              cachedInputTokens: cachedInputTokens || null,
              cacheWriteTokens: cacheWriteTokens || null,
              error,
            }),
          );

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

export class Agent extends Context.Service<Agent, Effect.Success<typeof make>>()("simha/Agent") {}

export const AgentLive = Layer.effect(Agent, make);

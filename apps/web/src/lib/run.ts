/**
 * A run as it streams in: steps, answer text and render blocks, folded from
 * agent events. Also converts a stored run (transcript) to the same shape, so
 * live and reloaded answers render with the same components.
 */
import type { AgentEvent, DocumentInfo, FormDraft, RenderBlock, RunTranscript } from "@simrs/shared";
import { request } from "./api.ts";
import { readEventStream } from "./sse.ts";
import type { StepView } from "./steps.ts";

type RunStatus = "running" | "done" | "error" | "stopped";

export interface RunView {
  readonly key: string;
  readonly question: string;
  readonly status: RunStatus;
  readonly runId: string | null;
  readonly conversationId: string | null;
  readonly model: string | null;
  readonly askedBy: string | null;
  /** All answer text so far (while streaming); the final answer when done. */
  readonly text: string;
  readonly steps: ReadonlyArray<StepView>;
  readonly blocks: ReadonlyArray<RenderBlock>;
  readonly documents: ReadonlyArray<DocumentInfo>;
  /** Form drafts made or changed in this run (latest state of each). */
  readonly drafts: ReadonlyArray<FormDraft>;
  readonly fixIds: ReadonlyArray<string>;
  readonly error: string | null;
  readonly at: string;
  /** True while answer text is streaming in (the last event was text). */
  readonly writing: boolean;
  /** When the model got its latest turn (run start or last tool result), for the "berpikir" timer. */
  readonly waitingSince: number;
  /** The model's thinking in its current turn, streamed live (not stored). */
  readonly reasoning: string;
}

export const emptyRun = (question: string, key: string = crypto.randomUUID()): RunView => ({
  key,
  question,
  status: "running",
  runId: null,
  conversationId: null,
  model: null,
  askedBy: null,
  text: "",
  steps: [],
  blocks: [],
  documents: [],
  drafts: [],
  fixIds: [],
  error: null,
  at: new Date().toISOString(),
  writing: false,
  waitingSince: Date.now(),
  reasoning: "",
});

export const applyEvent = (run: RunView, event: AgentEvent): RunView => {
  switch (event._tag) {
    case "run_started":
      return { ...run, runId: event.runId, conversationId: event.conversationId, model: `${event.provider} · ${event.model}` };
    case "text_delta":
      return { ...run, text: run.text + event.text, writing: true };
    case "reasoning_delta":
      return { ...run, reasoning: run.reasoning + event.text, writing: false };
    case "tool_input_delta": {
      const exists = run.steps.some((s) => s.id === event.draftId);
      return {
        ...run,
        writing: false,
        steps: exists
          ? run.steps.map((s) => (s.id === event.draftId ? { ...s, draft: (s.draft ?? "") + event.delta } : s))
          : [
              ...run.steps,
              { id: event.draftId, name: event.name, input: null, output: null, error: null, durationMs: null, running: true, draft: event.delta },
            ],
      };
    }
    case "tool_started": {
      const step: StepView = { id: event.callId, name: event.name, input: event.args, output: null, error: null, durationMs: null, running: true, draft: null };
      const drafted = event.draftId !== undefined && run.steps.some((s) => s.id === event.draftId);
      return {
        ...run,
        writing: false,
        steps: drafted ? run.steps.map((s) => (s.id === event.draftId ? step : s)) : [...run.steps, step],
      };
    }
    case "tool_finished": {
      const fixId =
        event.ok && event.name === "usulkanPerbaikan" ? (event.result as { fixId?: string } | undefined)?.fixId : undefined;
      return {
        ...run,
        waitingSince: Date.now(),
        reasoning: "",
        steps: run.steps.map((s) =>
          s.id === event.callId
            ? { ...s, running: false, output: event.result ?? null, error: event.ok ? null : (event.error ?? "Gagal."), durationMs: event.durationMs }
            : s,
        ),
        fixIds: fixId ? [...run.fixIds, fixId] : run.fixIds,
      };
    }
    case "render":
      return { ...run, blocks: [...run.blocks, event.block] };
    case "document":
      return { ...run, documents: [...run.documents, event.document] };
    case "draft":
      return {
        ...run,
        drafts: run.drafts.some((d) => d.id === event.draft.id)
          ? run.drafts.map((d) => (d.id === event.draft.id ? event.draft : d))
          : [...run.drafts, event.draft],
      };
    case "done":
      return { ...run, status: "done", text: event.text };
    case "error":
      return { ...run, status: "error", error: event.message };
  }
};

export const fromTranscript = (run: RunTranscript): RunView => ({
  key: run.id,
  question: run.question,
  status: run.status === "ok" ? "done" : run.status === "interrupted" ? "stopped" : run.status === "running" ? "running" : "error",
  runId: run.id,
  conversationId: null,
  model: `${run.provider} · ${run.model}`,
  askedBy: run.askedBy,
  text: run.finalText ?? "",
  steps: run.steps.map((s) => ({
    id: s.id,
    name: s.name,
    input: s.input,
    output: s.output,
    error: s.ok ? null : (s.error ?? "Gagal."),
    durationMs: s.durationMs,
    running: false,
    draft: null,
  })),
  blocks: run.blocks,
  documents: run.documents,
  drafts: run.drafts,
  fixIds: run.fixIds,
  error: run.error,
  at: run.startedAt,
  writing: false,
  waitingSince: Date.parse(run.startedAt),
  reasoning: "",
});

/**
 * POSTs to a streaming endpoint and reports every update. Resolves with the
 * final view; an abort marks the run as stopped.
 */
export const streamRun = async (
  path: string,
  body: unknown,
  initial: RunView,
  onUpdate: (run: RunView) => void,
  signal: AbortSignal,
): Promise<RunView> => {
  let run = initial;
  try {
    const response = await request("POST", path, body, signal);
    await readEventStream(response, (event) => {
      run = applyEvent(run, event);
      onUpdate(run);
    });
    if (run.status === "running") run = { ...run, status: "error", error: "Koneksi terputus sebelum jawaban selesai." };
  } catch (error) {
    run =
      error instanceof DOMException && error.name === "AbortError"
        ? { ...run, status: "stopped", steps: run.steps.filter((s) => s.draft === null).map((s) => ({ ...s, running: false })) }
        : { ...run, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
  onUpdate(run);
  return run;
};

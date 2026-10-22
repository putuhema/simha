/**
 * A run as it streams in: steps, answer text and render blocks, folded from
 * agent events. Also converts a stored run (transcript) to the same shape, so
 * live and reloaded answers render with the same components.
 */
import type { AgentEvent, RenderBlock, RunTranscript } from "@simrs/shared";
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
  readonly fixIds: ReadonlyArray<string>;
  readonly error: string | null;
  readonly at: string;
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
  fixIds: [],
  error: null,
  at: new Date().toISOString(),
});

export const applyEvent = (run: RunView, event: AgentEvent): RunView => {
  switch (event._tag) {
    case "run_started":
      return { ...run, runId: event.runId, conversationId: event.conversationId, model: `${event.provider} · ${event.model}` };
    case "text_delta":
      return { ...run, text: run.text + event.text };
    case "tool_started":
      return {
        ...run,
        steps: [
          ...run.steps,
          { id: event.callId, name: event.name, input: event.args, output: null, error: null, durationMs: null, running: true },
        ],
      };
    case "tool_finished": {
      const fixId =
        event.ok && event.name === "usulkanPerbaikan" ? (event.result as { fixId?: string } | undefined)?.fixId : undefined;
      return {
        ...run,
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
  })),
  blocks: run.blocks,
  fixIds: run.fixIds,
  error: run.error,
  at: run.startedAt,
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
        ? { ...run, status: "stopped", steps: run.steps.map((s) => ({ ...s, running: false })) }
        : { ...run, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
  onUpdate(run);
  return run;
};

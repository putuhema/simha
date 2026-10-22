/**
 * OpenAI-compatible Chat Completions adapter (streaming, function tools).
 *
 * Covers OpenAI, Ollama, vLLM, LM Studio, OpenRouter, Gemini's OpenAI
 * endpoint and gateways that speak the same API, chosen with LLM_BASE_URL.
 */
import OpenAI, { APIError } from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions";
import { LlmError, streamFrom, type LlmClientService, type LlmInfo } from "../LlmClient.ts";
import { parseArgs, type ChatMessage, type ChatRequest, type LlmEvent, type StopReason, type ToolCall, type ToolSpec } from "../types.ts";

export interface OpenAiCompatOptions {
  readonly info: LlmInfo;
  readonly apiKey: string | undefined;
  readonly baseUrl: string | undefined;
}

/**
 * Accepts both the base URL ("https://host/v1") and the full endpoint
 * ("https://host/v1/chat/completions") people often copy from docs.
 */
export const normalizeBaseUrl = (url: string | undefined): string | undefined => {
  if (url === undefined || url.trim() === "") return undefined;
  return url.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
};

const toOpenAiTools = (tools: ReadonlyArray<ToolSpec>): Array<ChatCompletionTool> =>
  tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: { ...t.parameters, type: "object" } },
  }));

export const toOpenAiMessages = (system: string, messages: ReadonlyArray<ChatMessage>): Array<ChatCompletionMessageParam> => [
  { role: "system", content: system },
  ...messages.map((m): ChatCompletionMessageParam => {
    switch (m.role) {
      case "user":
        return { role: "user", content: m.text };
      case "assistant":
        return m.toolCalls.length === 0
          ? { role: "assistant", content: m.text }
          : {
              role: "assistant",
              content: m.text === "" ? null : m.text,
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args ?? {}) },
              })),
            };
      case "tool":
        return { role: "tool", tool_call_id: m.toolCallId, content: m.isError ? `ERROR: ${m.content}` : m.content };
    }
  }),
];

/** Collects streamed tool-call fragments (they arrive split across chunks, keyed by index). */
export class ToolCallAccumulator {
  private readonly parts = new Map<number, { id: string; name: string; args: string }>();

  /** Adds a chunk's fragments; returns them as live `tool_input_delta` events (once the call has a name). */
  add(chunk: ChatCompletionChunk): Array<LlmEvent> {
    const live: Array<LlmEvent> = [];
    for (const choice of chunk.choices) {
      for (const delta of choice.delta?.tool_calls ?? []) {
        const part = this.parts.get(delta.index) ?? { id: "", name: "", args: "" };
        if (delta.id) part.id = delta.id;
        if (delta.function?.name) part.name += delta.function.name;
        const args = delta.function?.arguments ?? "";
        part.args += args;
        this.parts.set(delta.index, part);
        if (part.name !== "") live.push({ type: "tool_input_delta", index: delta.index, name: part.name, delta: args });
      }
    }
    return live;
  }

  calls(): Array<ToolCall> {
    return [...this.parts.entries()]
      .toSorted(([a], [b]) => a - b)
      .filter(([, p]) => p.name !== "")
      .map(([index, p]) => ({ id: p.id || `call_${index}_${crypto.randomUUID().slice(0, 8)}`, name: p.name, args: parseArgs(p.args) }));
  }
}

/**
 * Thinking text, which is not part of the OpenAI spec: DeepSeek, vLLM and
 * most gateways send `reasoning_content`, OpenRouter and Ollama `reasoning`.
 */
export const reasoningOf = (delta: unknown): string => {
  if (delta === null || typeof delta !== "object") return "";
  const d = delta as { reasoning_content?: unknown; reasoning?: unknown };
  const value = d.reasoning_content ?? d.reasoning;
  return typeof value === "string" ? value : "";
};

export const toStopReason = (finishReason: string | null | undefined, hasToolCalls: boolean): StopReason => {
  // Some servers report "stop" even when they returned tool calls.
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "content_filter") return "refusal";
  if (hasToolCalls) return "tool_use";
  return finishReason === "stop" ? "end_turn" : "other";
};

const toLlmError = (provider: string, cause: unknown): LlmError => {
  if (cause instanceof APIError) {
    const status = cause.status;
    const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
    const hint =
      status === 401 ? " (periksa LLM_API_KEY)" : status === 404 ? " (periksa LLM_MODEL dan LLM_BASE_URL)" : status === 429 ? " (batas pemakaian tercapai)" : "";
    return new LlmError({ provider, retryable, message: `${provider} ${status ?? "connection"} error${hint}: ${cause.message}` });
  }
  return new LlmError({ provider, retryable: false, message: cause instanceof Error ? cause.message : String(cause) });
};

export const makeOpenAiCompatClient = (options: OpenAiCompatOptions): LlmClientService => {
  const { info } = options;
  const baseURL = normalizeBaseUrl(options.baseUrl);
  // Local servers (Ollama, LM Studio) need no key, but the SDK requires a value.
  const client = new OpenAI({ apiKey: options.apiKey || "not-needed", ...(baseURL ? { baseURL } : {}) });

  async function* run(request: ChatRequest): AsyncGenerator<LlmEvent> {
    const controller = new AbortController();
    try {
      const stream = await client.chat.completions.create(
        {
          model: info.model,
          stream: true,
          messages: toOpenAiMessages(request.system, request.messages),
          ...(request.tools.length > 0 ? { tools: toOpenAiTools(request.tools) } : {}),
        },
        { signal: controller.signal },
      );
      const calls = new ToolCallAccumulator();
      let text = "";
      let finishReason: string | null = null;
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      for await (const chunk of stream) {
        yield* calls.add(chunk);
        for (const choice of chunk.choices) {
          const reasoning = reasoningOf(choice.delta);
          if (reasoning) yield { type: "reasoning_delta", text: reasoning };
          const delta = choice.delta?.content;
          if (delta) {
            text += delta;
            yield { type: "text_delta", text: delta };
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
      const toolCalls = calls.calls();
      const stopReason = toStopReason(finishReason, toolCalls.length > 0);
      if (stopReason === "tool_use") for (const call of toolCalls) yield { type: "tool_call", call };
      yield {
        type: "done",
        stopReason,
        native: { provider: info.provider, model: info.model, content: { text, toolCalls } },
        ...(usage ? { usage } : {}),
      };
    } finally {
      controller.abort();
    }
  }

  return { info, chat: (request) => streamFrom(info.provider, () => run(request), toLlmError) };
};

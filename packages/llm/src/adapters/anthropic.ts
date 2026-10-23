/**
 * Claude adapter (Anthropic Messages API, streaming, client tools).
 *
 * - Assistant turns are replayed exactly as Claude returned them (the
 *   `native` content), so thinking blocks stay valid across tool rounds.
 * - All tool results of one turn go back in a single user message.
 * - On models that support it, server-side fallback is enabled: if a safety
 *   classifier declines the request, the API retries on a suitable model.
 */
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTool,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { LlmError, streamFrom, type LlmClientService, type LlmInfo } from "../LlmClient.ts";
import type { ChatMessage, ChatRequest, LlmEvent, StopReason, ToolSpec, Usage } from "../types.ts";

const MAX_TOKENS = 64_000;

/** Models that accept `fallbacks: "default"` (Claude API only). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface AnthropicOptions {
  readonly info: LlmInfo;
  readonly apiKey: string | undefined;
  /** Only for proxies or gateways; the default is Anthropic's API. */
  readonly baseUrl: string | undefined;
}

export const toAnthropicTools = (tools: ReadonlyArray<ToolSpec>): Array<BetaTool> =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { ...t.parameters, type: "object" } as BetaTool["input_schema"],
    // Stream tool inputs as they are generated. The server then skips its own
    // validation; every input is checked against the tool's Schema before it runs.
    eager_input_streaming: true,
  }));

/** Neutral history -> Anthropic messages. Consecutive tool results are merged into one user message. */
export const toAnthropicMessages = (messages: ReadonlyArray<ChatMessage>, info: LlmInfo): Array<BetaMessageParam> => {
  const out: Array<BetaMessageParam> = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.modelText ?? m.text });
    } else if (m.role === "assistant") {
      const sameModel = m.native?.provider === info.provider && m.native.model === info.model;
      if (sameModel && Array.isArray(m.native?.content)) {
        out.push({ role: "assistant", content: m.native.content as Array<BetaContentBlockParam> });
      } else {
        const content: Array<BetaContentBlockParam> = [];
        if (m.text !== "") content.push({ type: "text", text: m.text });
        for (const call of m.toolCalls) {
          content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args ?? {} });
        }
        out.push({ role: "assistant", content: content.length > 0 ? content : [{ type: "text", text: "(kosong)" }] });
      }
    } else {
      const block = { type: "tool_result" as const, tool_use_id: m.toolCallId, content: m.content, is_error: m.isError };
      const last = out.at(-1);
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
};

const toStopReason = (reason: string | null | undefined): StopReason => {
  switch (reason) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "refusal":
      return reason;
    case "stop_sequence":
      return "end_turn";
    default:
      return "other";
  }
};

/**
 * Claude reports cache reads and writes separately from `input_tokens`, and
 * charges for them differently. `inputTokens` is the total, so a run's token
 * count is comparable with OpenAI-style providers (which include cached tokens
 * in `prompt_tokens`).
 */
export const toAnthropicUsage = (usage: BetaUsage): Usage => {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + cacheRead + cacheWrite,
    outputTokens: usage.output_tokens,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
};

const toLlmError = (provider: string, cause: unknown): LlmError => {
  if (cause instanceof APIError) {
    const status = cause.status;
    const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
    const hint =
      status === 401 ? " (periksa LLM_API_KEY)" : status === 404 ? " (periksa LLM_MODEL)" : status === 429 ? " (batas pemakaian tercapai)" : "";
    return new LlmError({ provider, retryable, message: `Claude API ${status ?? "connection"} error${hint}: ${cause.message}` });
  }
  return new LlmError({ provider, retryable: false, message: cause instanceof Error ? cause.message : String(cause) });
};

export const makeAnthropicClient = (options: AnthropicOptions): LlmClientService => {
  const { info } = options;
  const client = new Anthropic({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
  });
  // Server-side fallback is a Claude API feature; skip it behind a custom gateway.
  const useFallback = options.baseUrl === undefined && FALLBACK_MODELS.has(info.model);


  async function* run(request: ChatRequest): AsyncGenerator<LlmEvent> {
    const stream = client.beta.messages.stream({
      model: info.model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: toAnthropicMessages(request.messages, info),
      ...(request.tools.length > 0 ? { tools: toAnthropicTools(request.tools) } : {}),
      // Cache the growing prefix (tools, system, history) between agent steps.
      cache_control: { type: "ephemeral" },
      ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    });
    try {
      const toolNames = new Map<number, string>();
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          toolNames.set(event.index, event.content_block.name);
          yield { type: "tool_input_delta", index: event.index, name: event.content_block.name, delta: "" };
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") yield { type: "text_delta", text: event.delta.text };
          else if (event.delta.type === "thinking_delta") yield { type: "reasoning_delta", text: event.delta.thinking };
          else if (event.delta.type === "input_json_delta") {
            const name = toolNames.get(event.index);
            if (name !== undefined) yield { type: "tool_input_delta", index: event.index, name, delta: event.delta.partial_json };
          }
        }
      }
      const message = await stream.finalMessage();
      const stopReason = toStopReason(message.stop_reason);
      // Never run tools from a turn that was cut off or refused.
      if (stopReason === "tool_use") {
        for (const block of message.content) {
          if (block.type === "tool_use") yield { type: "tool_call", call: { id: block.id, name: block.name, args: block.input } };
        }
      }
      yield {
        type: "done",
        stopReason,
        native: { provider: info.provider, model: info.model, content: message.content },
        usage: toAnthropicUsage(message.usage),
      };
    } finally {
      stream.abort();
    }
  }

  return { info, chat: (request) => streamFrom(info.provider, () => run(request), toLlmError) };
};

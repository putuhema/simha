/**
 * Provider-neutral chat types. Adapters translate these to and from each
 * provider's wire format; nothing outside packages/llm sees provider types.
 */

/** A tool as offered to the model: name, description and JSON Schema of its parameters. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** A tool call requested by the model. `args` is parsed JSON, or the raw string if it was not valid JSON. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
  /**
   * The argument JSON exactly as the provider streamed it. Replayed verbatim
   * when the provider does not keep its own native turn, so the prompt cache
   * still sees an unchanged prefix.
   */
  readonly rawArgs?: string;
}

/**
 * The provider's own form of an assistant turn. Sent back unchanged on the
 * next request to the same provider and model, so nothing is lost (e.g.
 * Claude's thinking blocks must be replayed exactly).
 */
export interface NativeTurn {
  readonly provider: string;
  readonly model: string;
  readonly content: unknown;
}

export type ChatMessage =
  | {
      readonly role: "user";
      /** What the user typed (and what the UI shows). */
      readonly text: string;
      /**
       * Exact text sent to the model when it differs from `text`, e.g. with the
       * learned-knowledge block appended. Stored and replayed unchanged, so the
       * provider's prompt cache sees the same prefix on the next question.
       */
      readonly modelText?: string;
    }
  | {
      readonly role: "assistant";
      readonly text: string;
      readonly toolCalls: ReadonlyArray<ToolCall>;
      readonly native?: NativeTurn | undefined;
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly name: string;
      /** Tool result as text (usually JSON). */
      readonly content: string;
      readonly isError: boolean;
    };

export interface ChatRequest {
  readonly system: string;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly tools: ReadonlyArray<ToolSpec>;
  /**
   * Stable id of the conversation, for providers whose cache routing benefits
   * from it (OpenAI `prompt_cache_key`). Never shown to the user.
   */
  readonly cacheKey?: string;
}

/** Why the model stopped. `refusal` and `max_tokens` end the run; tools must not be run on a truncated turn. */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface Usage {
  /** Total input tokens, including tokens read from or written to the prompt cache. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Input tokens served from the provider's prompt cache (billed cheaper or free). */
  readonly cachedInputTokens?: number;
  /** Input tokens written into the prompt cache on this turn (Anthropic charges extra for these). */
  readonly cacheWriteTokens?: number;
}

export type LlmEvent =
  | { readonly type: "text_delta"; readonly text: string }
  /** A piece of the model's thinking, shown live; never sent back to the model. */
  | { readonly type: "reasoning_delta"; readonly text: string }
  /**
   * A piece of a tool call while the model is still writing it, so the UI can
   * show the step (and its SQL) before the turn ends. `index` orders calls in
   * the turn; the complete call still arrives later as `tool_call`.
   */
  | { readonly type: "tool_input_delta"; readonly index: number; readonly name: string; readonly delta: string }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | {
      readonly type: "done";
      readonly stopReason: StopReason;
      readonly native?: NativeTurn | undefined;
      readonly usage?: Usage | undefined;
    };

/** Parses tool arguments, keeping the raw text when it is not valid JSON so the tool's Schema check can explain the problem to the model. */
export const parseArgs = (raw: string): unknown => {
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

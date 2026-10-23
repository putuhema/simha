import { Context, Schema, Stream } from "effect";
import type { ChatRequest, LlmEvent } from "./types.ts";

/** The provider call failed. `message` is safe to show to IT staff. */
export class LlmError extends Schema.TaggedError<LlmError>()("LlmError", {
  provider: Schema.String,
  message: Schema.String,
  /** Rate limits, timeouts and 5xx are worth retrying; bad requests and auth errors are not. */
  retryable: Schema.Boolean,
}) {}

export interface LlmInfo {
  /** Name from LLM_PROVIDER, recorded in the audit log (e.g. "anthropic", "ollama"). */
  readonly provider: string;
  /** Which adapter handles it. */
  readonly adapter: "anthropic" | "openai-compat" | "fake";
  readonly model: string;
  /** Mask NIK, phone numbers and addresses before data reaches this provider. */
  readonly maskPii: boolean;
}

export interface LlmClientService {
  readonly info: LlmInfo;
  /** One model turn, streamed as normalized events, always ending with `done`. */
  readonly chat: (request: ChatRequest) => Stream.Stream<LlmEvent, LlmError>;
}

export class LlmClient extends Context.Service<LlmClient, LlmClientService>()("simha/LlmClient") {}

/** Wraps an async generator of events as a Stream. Stopping the stream runs the generator's `finally` (adapters abort the HTTP request there). */
export const streamFrom = (
  provider: string,
  run: () => AsyncIterable<LlmEvent>,
  toError: (provider: string, cause: unknown) => LlmError,
): Stream.Stream<LlmEvent, LlmError> =>
  Stream.suspend(() => Stream.fromAsyncIterable(run(), (cause) => toError(provider, cause)));

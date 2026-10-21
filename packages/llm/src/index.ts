/**
 * @simrs/llm: one chat interface over several AI providers.
 */
export { fakeTurn, makeFakeClient } from "./adapters/fake.ts";
export type { FakeClient, FakeTurn } from "./adapters/fake.ts";
export { LlmClientLive, LlmConfigError, LlmSettingsConfig, makeLlmClient } from "./config.ts";
export type { LlmSettings } from "./config.ts";
export { LlmClient, LlmError } from "./LlmClient.ts";
export type { LlmClientService, LlmInfo } from "./LlmClient.ts";
export type { ChatMessage, ChatRequest, LlmEvent, NativeTurn, StopReason, ToolCall, ToolSpec, Usage } from "./types.ts";

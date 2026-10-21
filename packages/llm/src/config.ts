import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import { makeAnthropicClient } from "./adapters/anthropic.ts";
import { makeFakeClient } from "./adapters/fake.ts";
import { makeOpenAiCompatClient } from "./adapters/openai-compat.ts";
import { LlmClient, type LlmClientService, type LlmInfo } from "./LlmClient.ts";

/** AI provider settings, from .env (LLM_*) now and from the settings page later. */
export interface LlmSettings {
  /** "anthropic", "fake", or any name for an OpenAI-compatible server ("openai", "ollama", "vikey", ...). */
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string | undefined;
  readonly apiKey: Redacted.Redacted<string> | undefined;
  readonly maskPii: boolean;
}

export class LlmConfigError extends Schema.TaggedError<LlmConfigError>()("LlmConfigError", {
  message: Schema.String,
}) {}

/** Base URLs for well-known local servers, so LLM_BASE_URL can be left empty for them. */
const DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  "lm-studio": "http://localhost:1234/v1",
};

const optionalString = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map(Option.filter((s) => s.trim() !== "")),
    Config.map(Option.getOrUndefined),
  );

export const LlmSettingsConfig: Config.Config<LlmSettings> = Config.all({
  provider: Config.String("LLM_PROVIDER").pipe(
    Config.withDefault("anthropic"),
    Config.map((p) => p.trim().toLowerCase()),
  ),
  model: Config.String("LLM_MODEL").pipe(Config.withDefault("")),
  baseUrl: optionalString("LLM_BASE_URL"),
  apiKey: optionalString("LLM_API_KEY").pipe(Config.map((k) => (k === undefined ? undefined : Redacted.make(k)))),
  maskPii: Config.Boolean("LLM_MASK_PII").pipe(Config.withDefault(true)),
});

/** Builds the adapter for the given settings. Adding a provider = one adapter file + one branch here. */
export const makeLlmClient = (settings: LlmSettings): Effect.Effect<LlmClientService, LlmConfigError> =>
  Effect.suspend(() => {
    const adapter: LlmInfo["adapter"] =
      settings.provider === "anthropic" ? "anthropic" : settings.provider === "fake" ? "fake" : "openai-compat";
    const info: LlmInfo = { provider: settings.provider, adapter, model: settings.model, maskPii: settings.maskPii };
    const apiKey = settings.apiKey === undefined ? undefined : Redacted.value(settings.apiKey);

    if (adapter === "fake") return Effect.succeed(makeFakeClient([], { ...info, model: settings.model || "fake-model" }));
    if (settings.model === "") {
      return Effect.fail(new LlmConfigError({ message: "LLM_MODEL is empty. Set the model name in .env." }));
    }
    if (adapter === "anthropic") {
      return Effect.succeed(makeAnthropicClient({ info, apiKey, baseUrl: settings.baseUrl }));
    }
    const baseUrl = settings.baseUrl ?? DEFAULT_BASE_URLS[settings.provider];
    if (baseUrl === undefined && settings.provider !== "openai") {
      return Effect.fail(
        new LlmConfigError({
          message: `LLM_PROVIDER "${settings.provider}" is treated as OpenAI-compatible, so LLM_BASE_URL is required (e.g. http://localhost:11434/v1).`,
        }),
      );
    }
    return Effect.succeed(makeOpenAiCompatClient({ info, apiKey, baseUrl }));
  });

/** LlmClient from .env. */
export const LlmClientLive = Layer.effect(LlmClient, Effect.flatMap(LlmSettingsConfig, makeLlmClient));

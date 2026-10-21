import { Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { makeLlmClient, type LlmSettings } from "./config.ts";

const base: LlmSettings = { provider: "anthropic", model: "claude-opus-5-5", baseUrl: undefined, apiKey: Redacted.make("k"), maskPii: true };
const build = (s: Partial<LlmSettings>) => Effect.runPromise(Effect.result(makeLlmClient({ ...base, ...s })));

describe("makeLlmClient", () => {
  it("picks the adapter from LLM_PROVIDER", async () => {
    const claude = await build({});
    expect(claude._tag === "Success" && claude.success.info.adapter).toBe("anthropic");
    const ollama = await build({ provider: "ollama", model: "qwen3" });
    expect(ollama._tag === "Success" && ollama.success.info).toMatchObject({ adapter: "openai-compat", provider: "ollama" });
    const gateway = await build({ provider: "vikey", model: "m", baseUrl: "https://api.example.ai/v1/chat/completions" });
    expect(gateway._tag === "Success" && gateway.success.info.adapter).toBe("openai-compat");
    const fake = await build({ provider: "fake", model: "" });
    expect(fake._tag === "Success" && fake.success.info.adapter).toBe("fake");
  });

  it("explains missing settings", async () => {
    const noModel = await build({ model: "" });
    expect(noModel._tag === "Failure" && noModel.failure.message).toMatch(/LLM_MODEL/);
    const noUrl = await build({ provider: "vllm", model: "m" });
    expect(noUrl._tag === "Failure" && noUrl.failure.message).toMatch(/LLM_BASE_URL/);
  });
});

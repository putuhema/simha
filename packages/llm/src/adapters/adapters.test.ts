import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatCompletionChunk } from "openai/resources/chat/completions/completions";
import { describe, expect, it } from "vitest";
import type { LlmInfo } from "../LlmClient.ts";
import type { ChatMessage } from "../types.ts";
import { toAnthropicMessages, toAnthropicTools, toAnthropicUsage } from "./anthropic.ts";
import {
  cachedTokensOf,
  normalizeBaseUrl,
  promptCacheKey,
  reasoningOf,
  toOpenAiMessages,
  toStopReason,
  ToolCallAccumulator,
} from "./openai-compat.ts";

const history: Array<ChatMessage> = [
  { role: "user", text: "Cek kamar RM 000002" },
  {
    role: "assistant",
    text: "Saya cek.",
    toolCalls: [
      { id: "c1", name: "riwayatKamar", args: { noRawat: "2026/10/21/000002" } },
      { id: "c2", name: "statusKamar", args: { namaBangsal: "Mawar" } },
    ],
  },
  { role: "tool", toolCallId: "c1", name: "riwayatKamar", content: '{"jumlahAktif":2}', isError: false },
  { role: "tool", toolCallId: "c2", name: "statusKamar", content: "noRawat salah", isError: true },
];

const chunk = (tool_calls: unknown) => ({ choices: [{ index: 0, delta: { tool_calls } }] }) as unknown as ChatCompletionChunk;

const claude: LlmInfo = { provider: "anthropic", adapter: "anthropic", model: "claude-opus-5-5", maskPii: true };

describe("Anthropic format", () => {
  it("puts all tool results of a turn in one user message", () => {
    const messages = toAnthropicMessages(history, claude);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "Saya cek." },
      { type: "tool_use", id: "c1", name: "riwayatKamar", input: { noRawat: "2026/10/21/000002" } },
      { type: "tool_use", id: "c2", name: "statusKamar", input: { namaBangsal: "Mawar" } },
    ]);
    expect(messages[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "c1", content: '{"jumlahAktif":2}', is_error: false },
      { type: "tool_result", tool_use_id: "c2", content: "noRawat salah", is_error: true },
    ]);
  });

  it("sends modelText (question plus knowledge) when it differs from the stored text", () => {
    const [message] = toAnthropicMessages(
      [{ role: "user", text: "pertanyaan", modelText: "pertanyaan\n\n[Pengetahuan]\n- contoh" }],
      claude,
    );
    expect(message).toEqual({ role: "user", content: "pertanyaan\n\n[Pengetahuan]\n- contoh" });
  });

  it("replays Claude's own content (with thinking blocks) unchanged for the same model", () => {
    const native = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "c1", name: "riwayatKamar", input: {} },
    ];
    const messages = toAnthropicMessages(
      [{ role: "assistant", text: "", toolCalls: [], native: { provider: "anthropic", model: "claude-opus-5-5", content: native } }],
      claude,
    );
    expect(messages[0]?.content).toBe(native);
  });

  it("rebuilds turns that came from another provider", () => {
    const messages = toAnthropicMessages(
      [{ role: "assistant", text: "hi", toolCalls: [], native: { provider: "ollama", model: "qwen", content: {} } }],
      claude,
    );
    expect(messages[0]?.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("sends tool schemas as object input schemas with eager input streaming", () => {
    const [tool] = toAnthropicTools([
      { name: "riwayatKamar", description: "d", parameters: { type: "object", properties: { noRawat: { type: "string" } } } },
    ]);
    expect(tool).toMatchObject({
      name: "riwayatKamar",
      input_schema: { type: "object", properties: { noRawat: { type: "string" } } },
      eager_input_streaming: true,
    });
  });
});

describe("OpenAI-compatible format", () => {
  it("sends modelText for a user turn", () => {
    expect(toOpenAiMessages("SYS", [{ role: "user", text: "q", modelText: "q\n\n[Pengetahuan]" }])[1]).toEqual({
      role: "user",
      content: "q\n\n[Pengetahuan]",
    });
  });

  it("maps history to system/user/assistant(tool_calls)/tool messages", () => {
    const messages = toOpenAiMessages("SYS", history);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "tool"]);
    expect(messages[2]).toMatchObject({
      tool_calls: [
        { id: "c1", type: "function", function: { name: "riwayatKamar", arguments: '{"noRawat":"2026/10/21/000002"}' } },
        { id: "c2", type: "function", function: { name: "statusKamar", arguments: '{"namaBangsal":"Mawar"}' } },
      ],
    });
    expect(messages[4]).toEqual({ role: "tool", tool_call_id: "c2", content: "ERROR: noRawat salah" });
  });

  it("replays the original tool-call arguments so the prompt prefix stays identical", () => {
    const messages = toOpenAiMessages("SYS", [
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "c1", name: "jalankanQueryBaca", args: { sql: "SELECT 1" }, rawArgs: '{ "sql" : "SELECT 1" }' }],
      },
    ]);
    expect(messages[1]).toMatchObject({
      tool_calls: [{ id: "c1", function: { name: "jalankanQueryBaca", arguments: '{ "sql" : "SELECT 1" }' } }],
    });
  });

  it("assembles tool calls streamed in fragments", () => {
    const acc = new ToolCallAccumulator();
    acc.add(chunk([{ index: 0, id: "call_a", function: { name: "riwayat", arguments: '{"noRa' } }]));
    acc.add(chunk([{ index: 0, function: { name: "Kamar", arguments: 'wat":"x"}' } }]));
    acc.add(chunk([{ index: 1, function: { name: "statusKamar", arguments: "not json" } }]));
    const [a, b] = acc.calls();
    expect(a).toEqual({ id: "call_a", name: "riwayatKamar", args: { noRawat: "x" }, rawArgs: '{"noRawat":"x"}' });
    expect(b?.name).toBe("statusKamar");
    expect(b?.args).toBe("not json");
    expect(b?.id).toMatch(/^call_1_/);
  });

  it("reports tool-call fragments live once the call has a name", () => {
    const acc = new ToolCallAccumulator();
    expect(acc.add(chunk([{ index: 0, id: "call_a", function: { name: "jalankanQueryBaca", arguments: "" } }]))).toEqual([
      { type: "tool_input_delta", index: 0, name: "jalankanQueryBaca", delta: "" },
    ]);
    expect(acc.add(chunk([{ index: 0, function: { arguments: '{"sql":"SEL' } }]))).toEqual([
      { type: "tool_input_delta", index: 0, name: "jalankanQueryBaca", delta: '{"sql":"SEL' },
    ]);
    expect(acc.add({ choices: [{ index: 0, delta: { content: "hi" } }] } as unknown as ChatCompletionChunk)).toEqual([]);
  });

  it("reads thinking text from reasoning_content or reasoning", () => {
    expect(reasoningOf({ reasoning_content: "pikir" })).toBe("pikir");
    expect(reasoningOf({ reasoning: "pikir" })).toBe("pikir");
    expect(reasoningOf({ content: "jawab" })).toBe("");
    expect(reasoningOf(undefined)).toBe("");
  });

  it("treats tool calls as tool_use even when the server says 'stop'", () => {
    expect(toStopReason("stop", true)).toBe("tool_use");
    expect(toStopReason("tool_calls", true)).toBe("tool_use");
    expect(toStopReason("stop", false)).toBe("end_turn");
    expect(toStopReason("length", true)).toBe("max_tokens");
    expect(toStopReason("content_filter", false)).toBe("refusal");
  });

  it("accepts the base URL or the full chat/completions endpoint", () => {
    expect(normalizeBaseUrl("https://api.example.ai/v1/chat/completions")).toBe("https://api.example.ai/v1");
    expect(normalizeBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(normalizeBaseUrl("  ")).toBeUndefined();
  });
});

describe("prompt cache usage", () => {
  it("counts Claude cache reads and writes as input tokens and reports the cached part", () => {
    const usage = toAnthropicUsage({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 50,
    } as unknown as BetaUsage);
    expect(usage).toEqual({ inputTokens: 1_050, outputTokens: 20, cachedInputTokens: 900, cacheWriteTokens: 50 });
  });

  it("reads cached tokens from OpenAI, DeepSeek and gateway usage shapes", () => {
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: 640 } })).toBe(640);
    expect(cachedTokensOf({ prompt_cache_hit_tokens: 512 })).toBe(512);
    expect(cachedTokensOf({ cache_read_input_tokens: 256 })).toBe(256);
    expect(cachedTokensOf({ prompt_tokens: 10 })).toBe(0);
    expect(cachedTokensOf(undefined)).toBe(0);
  });

  it("sends a conversation cache key only to OpenAI", () => {
    const openai: LlmInfo = { ...claude, provider: "openai", adapter: "openai-compat" };
    const request = { system: "", messages: [], tools: [], cacheKey: "conversation-1" };
    expect(promptCacheKey(openai, request)).toBe("conversation-1");
    expect(promptCacheKey(claude, request)).toBeUndefined();
    expect(promptCacheKey(openai, { system: "", messages: [], tools: [] })).toBeUndefined();
  });
});

import type { ChatCompletionChunk } from "openai/resources/chat/completions/completions";
import { describe, expect, it } from "vitest";
import type { LlmInfo } from "../LlmClient.ts";
import type { ChatMessage } from "../types.ts";
import { toAnthropicMessages, toAnthropicTools } from "./anthropic.ts";
import { normalizeBaseUrl, toOpenAiMessages, toStopReason, ToolCallAccumulator } from "./openai-compat.ts";

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

  it("assembles tool calls streamed in fragments", () => {
    const acc = new ToolCallAccumulator();
    acc.add(chunk([{ index: 0, id: "call_a", function: { name: "riwayat", arguments: '{"noRa' } }]));
    acc.add(chunk([{ index: 0, function: { name: "Kamar", arguments: 'wat":"x"}' } }]));
    acc.add(chunk([{ index: 1, function: { name: "statusKamar", arguments: "not json" } }]));
    const [a, b] = acc.calls();
    expect(a).toEqual({ id: "call_a", name: "riwayatKamar", args: { noRawat: "x" } });
    expect(b?.name).toBe("statusKamar");
    expect(b?.args).toBe("not json");
    expect(b?.id).toMatch(/^call_1_/);
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

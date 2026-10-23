import type { ChatMessage } from "@simha/llm";
import { describe, expect, it } from "vitest";
import { compactHistory, estimateTokens, HISTORY_TOKEN_BUDGET } from "../src/agent/history.ts";

/** One complete turn: question, optional tool round, answer. */
const turn = (n: number, toolChars = 0): Array<ChatMessage> => {
  const messages: Array<ChatMessage> = [{ role: "user", text: `pertanyaan ${n}` }];
  if (toolChars > 0) {
    messages.push({
      role: "assistant",
      text: "",
      toolCalls: [{ id: `call_${n}`, name: "jalankanQueryBaca", args: { sql: "SELECT 1" } }],
    });
    messages.push({
      role: "tool",
      toolCallId: `call_${n}`,
      name: "jalankanQueryBaca",
      content: `${n}:${"x".repeat(toolChars)}`,
      isError: false,
    });
  }
  messages.push({ role: "assistant", text: `jawaban ${n}`, toolCalls: [] });
  return messages;
};

const roles = (messages: ReadonlyArray<ChatMessage>) => messages.map((message) => message.role);

describe("conversation history budget", () => {
  it("leaves a history that fits untouched", () => {
    const messages = [...turn(0), ...turn(1)];
    expect(compactHistory(messages)).toBe(messages);
    expect(estimateTokens(messages)).toBeLessThan(HISTORY_TOKEN_BUDGET);
  });

  it("drops whole old turns and keeps the newest turns byte-identical", () => {
    const messages = [...turn(0, 40_000), ...turn(1, 40_000), ...turn(2, 40_000), ...turn(3, 40_000)];
    const compacted = compactHistory(messages);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(roles(compacted)[0]).toBe("user");
    // The summary names the dropped turns, not their tool payload.
    expect(compacted[0]?.role === "user" && compacted[0].text).toContain("[Ringkasan percakapan sebelumnya");
    expect(compacted[0]?.role === "user" && compacted[0].text).toContain("pertanyaan 0 → jawaban 0");
    expect(JSON.stringify(compacted)).not.toContain("0:xxxx");
    // The last two turns keep their exact content.
    expect(compacted.slice(-4)).toEqual(messages.slice(-4));
    expect(compacted.some((message) => message.role === "user" && message.text.includes("pertanyaan 2"))).toBe(true);
  });

  it("keeps every tool result paired with its assistant tool call", () => {
    const messages = [...turn(0, 40_000), ...turn(1, 40_000), ...turn(2, 40_000)];
    const compacted = compactHistory(messages);
    const called = new Set(
      compacted.flatMap((message) => (message.role === "assistant" ? message.toolCalls.map((call) => call.id) : [])),
    );
    const results = compacted.flatMap((message) => (message.role === "tool" ? [message.toolCallId] : []));
    expect(results.every((id) => called.has(id))).toBe(true);
  });

  it("counts modelText and never leaks it into the summary", () => {
    const big = "k".repeat(100_000);
    const messages: Array<ChatMessage> = [
      { role: "user", text: "pertanyaan lama", modelText: `${big}\n\n[Pengetahuan]` },
      { role: "assistant", text: "jawaban lama", toolCalls: [] },
      ...turn(1),
    ];
    const compacted = compactHistory(messages);
    expect(compacted).not.toBe(messages);
    expect(compacted[0]?.role === "user" && compacted[0].text).toContain("pertanyaan lama");
    expect(compacted[0]?.role === "user" && compacted[0].text).not.toContain("k".repeat(20));
  });

  it("leaves the server-time line out of the summary", () => {
    const messages: Array<ChatMessage> = [
      { role: "user", text: "[Waktu server: Jumat, 23 Oktober 2026 pukul 20.00; 2026-10-23]\nBerapa pasien BPJS?" },
      { role: "assistant", text: "x".repeat(120_000), toolCalls: [] },
      { role: "user", text: "Lalu?" },
    ];
    const compacted = compactHistory(messages);
    expect(compacted[0]?.role === "user" && compacted[0].text).toContain("Berapa pasien BPJS?");
    expect(compacted[0]?.role === "user" && compacted[0].text).not.toContain("Waktu server");
  });

  it("keeps a single turn that is over budget rather than breaking it", () => {
    const messages = turn(0, 200_000);
    expect(estimateTokens(messages)).toBeGreaterThan(HISTORY_TOKEN_BUDGET);
    expect(compactHistory(messages)).toBe(messages);
  });
});

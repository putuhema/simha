import type { ChatMessage } from "@simha/llm";
import { describe, expect, it } from "vitest";
import { compactHistory, estimateTokens, HISTORY_TOKEN_BUDGET } from "../src/agent/history.ts";

/** One complete turn: question, optional tool round, answer. */
const turn = (n: number, toolChars = 0, content?: string): Array<ChatMessage> => {
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
      content: content ?? `${n}:${"x".repeat(toolChars)}`,
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

  it("shrinks old tool results before dropping their turns", () => {
    const messages = [...turn(0, 40_000), ...turn(1, 40_000), ...turn(2, 40_000), ...turn(3, 40_000)];
    const compacted = compactHistory(messages);
    // Every turn survives: the questions, the answers and the tool call pairing stay.
    expect(compacted.length).toBe(messages.length);
    expect(roles(compacted)).toEqual(roles(messages));
    expect(compacted.some((message) => message.role === "user" && message.text.includes("pertanyaan 0"))).toBe(true);
    // The payload is replaced by a one-line summary, not the whole row set.
    const tools = compacted.filter((message) => message.role === "tool");
    expect(tools.length).toBe(messages.filter((message) => message.role === "tool").length);
    // The two oldest results fit the budget; the newest turn is left alone.
    expect(tools.filter((message) => message.content.length < 300).length).toBe(2);
    expect(tools.some((message) => message.role === "tool" && message.content.startsWith("[ringkas]"))).toBe(true);
    expect(compacted[0]?.role === "user" && compacted[0].text).not.toContain("[Ringkasan percakapan");
  });

  it("keeps the identifying values a follow-up needs", () => {
    const pasien = JSON.stringify({
      pasien: [{ no_rkm_medis: "123456", nm_pasien: "Budi Santoso", jk: "L", umur: "40" }],
      lebihBanyak: false,
      catatan: "y".repeat(400),
    });
    const messages: Array<ChatMessage> = [...turn(0, pasien.length, pasien), ...turn(1)];
    const compacted = compactHistory(messages, 120);
    const result = compacted.find((message) => message.role === "tool");
    expect(result?.role === "tool" && result.content).toContain("no_rkm_medis=123456");
    expect(result?.role === "tool" && result.content.length).toBeLessThan(300);
    expect(estimateTokens(compacted)).toBeLessThanOrEqual(120);
  });

  it("never touches the newest turn", () => {
    const messages = [...turn(0, 40_000), ...turn(1, 40_000)];
    const compacted = compactHistory(messages);
    expect(compacted.slice(-4)).toEqual(messages.slice(-4));
  });

  it("drops old turns and summarizes when no tool result can be shrunk", () => {
    const messages: Array<ChatMessage> = [
      { role: "user", text: "pertanyaan 0" },
      { role: "assistant", text: "z".repeat(120_000), toolCalls: [] },
      { role: "user", text: "pertanyaan 1" },
      { role: "assistant", text: "jawaban 1", toolCalls: [] },
    ];
    const compacted = compactHistory(messages);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(compacted[0]?.role === "user" && compacted[0].text).toContain("[Ringkasan percakapan sebelumnya");
    expect(compacted[0]?.role === "user" && compacted[0].text).toContain("pertanyaan 0");
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

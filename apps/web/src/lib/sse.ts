/**
 * Reads a Server-Sent Events response from fetch (EventSource only does GET).
 * The harness sends `event: <tag>` and `data: <json>` blocks separated by a
 * blank line.
 */
import type { AgentEvent } from "@simha/shared";

/** Splits buffered text into complete event blocks; returns the events and the unfinished rest. */
export const parseSseChunk = (buffer: string): { events: Array<AgentEvent>; rest: string } => {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "") return [];
    try {
      return [JSON.parse(data) as AgentEvent];
    } catch {
      return [];
    }
  });
  return { events, rest };
};

/** Calls `onEvent` for every event until the stream ends or `signal` aborts. */
export const readEventStream = async (response: Response, onEvent: (event: AgentEvent) => void) => {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
  const last = parseSseChunk(`${buffer}\n\n`);
  for (const event of last.events) onEvent(event);
};

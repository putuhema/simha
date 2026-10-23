/**
 * Keeps the history replayed to the model inside a token budget.
 *
 * A follow-up resends the whole conversation, and past tool results (a query
 * can return 50 rows) are the largest part of it. Once the history is over the
 * budget, whole old turns are dropped and replaced by a short list of their
 * questions and answers; the most recent turns are left byte-identical so the
 * provider's prompt cache still reuses them.
 *
 * Only complete turns are dropped: a turn starts at a user message and ends
 * before the next one, so an assistant's tool calls are never separated from
 * their results.
 */
import type { ChatMessage } from "@simha/llm";

/** Input tokens of replayed history to keep. The system prompt and tools are on top of this. */
export const HISTORY_TOKEN_BUDGET = 24_000;

/** Room for the summary prepended when old turns are dropped (about 900 characters). */
const SUMMARY_RESERVE_TOKENS = 250;
const SUMMARY_HEADER = "[Ringkasan percakapan sebelumnya — hanya konteks, jangan diulang ke pengguna]";
const MAX_SUMMARY_CHARS = 900;
const MAX_SUMMARY_LINE = 140;

const messageChars = (message: ChatMessage): number => {
  switch (message.role) {
    case "user":
      return (message.modelText ?? message.text).length;
    case "assistant":
      // Same model: the native turn is what gets replayed. Otherwise the
      // adapter rebuilds it from text + tool calls.
      return message.native
        ? JSON.stringify(message.native.content).length
        : message.text.length + JSON.stringify(message.toolCalls).length;
    case "tool":
      return message.content.length;
  }
};

/** Rough token estimate (four characters per token); good enough to bound a prompt without a tokenizer. */
export const estimateTokens = (messages: ReadonlyArray<ChatMessage>): number =>
  Math.ceil(messages.reduce((chars, message) => chars + messageChars(message), 0) / 4);

const shorten = (text: string, max: number): string => {
  const clean = text.trim().replaceAll(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
};

/** The server-time line is added to every user turn; it is noise in a summary. */
const withoutContextLine = (text: string): string => text.replace(/^\[Waktu server:[^\]]*\]\s*/, "");

/** Splits at user messages; every turn is a user message plus its assistant/tool messages. */
const turnsOf = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ReadonlyArray<ChatMessage>> => {
  const starts: Array<number> = [];
  messages.forEach((message, index) => {
    if (index === 0 || message.role === "user") starts.push(index);
  });
  return starts.map((start, index) => messages.slice(start, starts[index + 1] ?? messages.length));
};

/** One line per dropped turn, so the model knows what was discussed without the tool payload. */
const summaryOf = (turns: ReadonlyArray<ReadonlyArray<ChatMessage>>): string => {
  const lines: Array<string> = [SUMMARY_HEADER];
  let used = SUMMARY_HEADER.length;
  for (const turn of turns) {
    const question = turn.find((message) => message.role === "user");
    if (question?.role !== "user") continue;
    const answer = turn.toReversed().find((message) => message.role === "assistant" && message.text.trim() !== "");
    const line = `- ${shorten(withoutContextLine(question.text), MAX_SUMMARY_LINE)}${answer?.role === "assistant" ? ` → ${shorten(answer.text, MAX_SUMMARY_LINE)}` : ""}`;
    if (used + line.length > MAX_SUMMARY_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines.length === 1 ? "" : lines.join("\n");
};

/** Puts the summary in front of the first kept user message (as plain text and as modelText). */
const prependSummary = (message: ChatMessage, summary: string): ChatMessage => {
  if (message.role !== "user") return message;
  return {
    ...message,
    text: `${summary}\n\n${message.text}`,
    ...(message.modelText === undefined ? {} : { modelText: `${summary}\n\n${message.modelText}` }),
  };
};

/** The history to send, untouched while it fits; newest turns kept when it does not. */
export const compactHistory = (
  messages: ReadonlyArray<ChatMessage>,
  budgetTokens: number = HISTORY_TOKEN_BUDGET,
): ReadonlyArray<ChatMessage> => {
  if (messages.length === 0 || estimateTokens(messages) <= budgetTokens) return messages;
  const turns = turnsOf(messages);
  if (turns.length <= 1) return messages;

  const last = turns[turns.length - 1];
  if (last === undefined) return messages;
  let firstKept = turns.length - 1;
  let keptTokens = estimateTokens(last);
  while (firstKept > 0) {
    const previous = turns[firstKept - 1];
    if (previous === undefined) break;
    const next = estimateTokens(previous);
    if (keptTokens + next + SUMMARY_RESERVE_TOKENS > budgetTokens) break;
    keptTokens += next;
    firstKept--;
  }
  if (firstKept === 0) return messages;

  const summary = summaryOf(turns.slice(0, firstKept));
  if (summary === "") return messages;
  const kept = turns.slice(firstKept).flat();
  const firstUser = kept.findIndex((message) => message.role === "user");
  if (firstUser === -1) return messages;
  return kept.map((message, index) => (index === firstUser ? prependSummary(message, summary) : message));
};

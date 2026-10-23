/**
 * Keeps the history replayed to the model inside a token budget, in two stages.
 *
 * A follow-up resends the whole conversation, and past tool results (a query
 * can return 50 rows) are the largest part of it. So:
 *
 * 1. Old tool results are replaced by what they found: the tool name, how many
 *    rows, and the identifying values (RM, no_rawat, period). The turns stay,
 *    so a follow-up like "sekarang per bulan" still knows the patient.
 * 2. Only when that is not enough are whole old turns dropped and replaced by
 *    a one-line list of their questions and answers.
 *
 * The newest turn is never touched, so the provider's prompt cache can reuse
 * it; an older turn is rewritten at most once, when it drops out of the newest
 * window.
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

/** A shrunk tool result is at most this long: the tool, its shape and the values that identify it. */
const MAX_TOOL_SUMMARY_CHARS = 260;
/** Longer than this and a tool result is worth shrinking when the budget is tight. */
const TOOL_SUMMARY_THRESHOLD = 200;
/** The first row, so the model still sees the units and the column names it will reuse. */
const MAX_TOOL_SAMPLE_CHARS = 90;

/** Column names worth keeping when a result is shrunk: the ones a follow-up refers to. */
const KEY_COLUMN =
  /^(no_|kd_|kode|id_|id$|nama|nm_|tgl|tanggal|waktu|jam|status|jumlah|total|kamar|bangsal|poliklinik|dokter|periode|bulan|tahun)/i;

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

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** Top-level shape: which keys exist and how many rows each list has. */
const shapeOf = (value: unknown): string => {
  if (Array.isArray(value)) return `${value.length} item`;
  if (value === null || typeof value !== "object") return shorten(String(value), 24);
  const parts: Array<string> = [];
  for (const [key, inner] of Object.entries(value)) {
    if (parts.length >= 5) break;
    if (Array.isArray(inner)) parts.push(`${key}:${inner.length}`);
    else if (inner !== null && typeof inner === "object") continue;
    else parts.push(`${key}:${shorten(String(inner), 24)}`);
  }
  return parts.join(" ");
};

/** `no_rkm_medis=123` for the first few identifying columns, at most two levels deep. */
const keysOf = (value: unknown, found: Array<string>, depth = 0): void => {
  if (depth > 2 || found.length >= 5) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 2)) keysOf(item, found, depth + 1);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, inner] of Object.entries(value)) {
    if (found.length >= 5) return;
    if (isScalar(inner) && KEY_COLUMN.test(key)) found.push(`${key}=${shorten(String(inner), 40)}`);
    else if (inner !== null && typeof inner === "object") keysOf(inner, found, depth + 1);
  }
};

/** The values of the first row, so the model keeps the units without keeping the rows. */
const sampleOf = (value: unknown): string => {
  const rows = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object"
      ? Object.values(value).find((inner) => Array.isArray(inner))
      : undefined;
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (first === undefined || first === null) return "";
  return shorten(JSON.stringify(first) ?? "", MAX_TOOL_SAMPLE_CHARS);
};

/**
 * A long tool result, replaced by what it found. Errors are kept verbatim: they
 * are short and the model needs them to fix the query.
 */
const compactToolContent = (message: Extract<ChatMessage, { role: "tool" }>): string => {
  if (message.isError) return message.content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.content);
  } catch {
    return `[ringkas] ${message.name}: ${shorten(message.content, 160)}`;
  }
  const keys: Array<string> = [];
  keysOf(parsed, keys);
  const sample = sampleOf(parsed);
  const line = [`[ringkas] ${message.name}`, shapeOf(parsed), keys.join(" "), sample === "" ? "" : `contoh ${sample}`]
    .filter((part) => part !== "")
    .join(" | ");
  return shorten(line, MAX_TOOL_SUMMARY_CHARS);
};

/** Replaces the long tool results of one turn; returns the turn itself when nothing changed. */
const shrinkTools = (turn: ReadonlyArray<ChatMessage>): ReadonlyArray<ChatMessage> => {
  let changed = false;
  const shrunk = turn.map((message) => {
    if (message.role !== "tool" || message.content.length <= TOOL_SUMMARY_THRESHOLD) return message;
    const content = compactToolContent(message);
    if (content.length >= message.content.length) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? shrunk : turn;
};

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

/**
 * Stage 1: shrink old tool results, oldest first, until the history fits. The
 * newest turn is left byte-identical.
 */
const shrinkOldTools = (
  turns: ReadonlyArray<ReadonlyArray<ChatMessage>>,
  tokens: number,
  budgetTokens: number,
): { readonly turns: ReadonlyArray<ReadonlyArray<ChatMessage>>; readonly tokens: number } => {
  let remaining = tokens;
  let changed = false;
  const result = turns.map((turn, index) => {
    if (index === turns.length - 1 || remaining <= budgetTokens) return turn;
    const shrunk = shrinkTools(turn);
    if (shrunk === turn) return turn;
    remaining -= estimateTokens(turn) - estimateTokens(shrunk);
    changed = true;
    return shrunk;
  });
  return { turns: changed ? result : turns, tokens: remaining };
};

/** The history to send: untouched while it fits, tool results shrunk, then old turns dropped. */
export const compactHistory = (
  messages: ReadonlyArray<ChatMessage>,
  budgetTokens: number = HISTORY_TOKEN_BUDGET,
): ReadonlyArray<ChatMessage> => {
  if (messages.length === 0) return messages;
  const tokens = estimateTokens(messages);
  if (tokens <= budgetTokens) return messages;
  const turns = turnsOf(messages);
  if (turns.length <= 1) return messages;

  const shrunk = shrinkOldTools(turns, tokens, budgetTokens);
  if (shrunk.tokens <= budgetTokens) return shrunk.turns.flat();

  // Stage 2: even the shrunk turns are too much, so drop them from the front.
  const kept = shrunk.turns;
  const last = kept[kept.length - 1];
  if (last === undefined) return messages;
  let firstKept = kept.length - 1;
  let keptTokens = estimateTokens(last);
  while (firstKept > 0) {
    const previous = kept[firstKept - 1];
    if (previous === undefined) break;
    const next = estimateTokens(previous);
    if (keptTokens + next + SUMMARY_RESERVE_TOKENS > budgetTokens) break;
    keptTokens += next;
    firstKept--;
  }
  if (firstKept === 0) return shrunk.turns.flat();

  const summary = summaryOf(kept.slice(0, firstKept));
  if (summary === "") return shrunk.turns.flat();
  const replayed = kept.slice(firstKept).flat();
  const firstUser = replayed.findIndex((message) => message.role === "user");
  if (firstUser === -1) return shrunk.turns.flat();
  return replayed.map((message, index) => (index === firstUser ? prependSummary(message, summary) : message));
};

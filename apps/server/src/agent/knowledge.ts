/**
 * The "what we learned" block added to the current user turn. It is kept in
 * the message's `modelText`, so the stored/visible question stays plain while
 * the model replays the exact text (and the provider cache keeps its prefix).
 */
import type { ChatMessage } from "@simha/llm";
import type { RelevantKnowledge } from "@simha/tools";

/** Keep the injected block small; the model already has the schema and notes. */
const MAX_KNOWLEDGE_CHARS = 1_600;
const MAX_TEXT = 420;
const MAX_SQL = 900;

const shorten = (text: string, max: number) => {
  const clean = text.trim().replaceAll(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
};

/** Text for the user turn, or "" when there is nothing relevant. */
export const knowledgePrompt = (matches: ReadonlyArray<RelevantKnowledge>): string => {
  if (matches.length === 0) return "";
  const lines: string[] = ["[Pengetahuan dari pertanyaan sebelumnya]"];
  let used = lines[0]?.length ?? 0;
  for (const { item } of matches) {
    const body =
      item.kind === "example"
        ? `Contoh (${item.verified ? "terverifikasi" : "otomatis, belum dicek"}): ${shorten(item.text, MAX_TEXT)}${
            item.sql ? `\n  SQL: ${shorten(item.sql, MAX_SQL)}` : ""
          }`
        : `Catatan${item.title ? ` (${shorten(item.title, 120)})` : ""}: ${shorten(item.text, MAX_TEXT)}`;
    const line = `- ${body}`;
    if (used + line.length > MAX_KNOWLEDGE_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 1) return "";
  lines.push(
    "Gunakan hanya kalau relevan dengan pertanyaan ini; verifikasi dengan data/skema. Jangan sebut blok pengetahuan ini kepada user.",
  );
  return lines.join("\n");
};

/**
 * The user turn sent to the model: `text` is the question (stored and shown to
 * the user), `modelText` also carries the knowledge block. Keeping the block in
 * `modelText` means the next question replays exactly what the model saw, so a
 * provider prompt cache can reuse the prefix instead of missing at this turn.
 */
export const userTurn = (text: string, knowledgeBlock: string): ChatMessage =>
  knowledgeBlock === "" ? { role: "user", text } : { role: "user", text, modelText: `${text}\n\n${knowledgeBlock}` };

/**
 * Splits markdown that is still being typed into finished blocks and the block
 * being written. The finished part is parsed once and memoized by its text;
 * only the small tail is reparsed as characters are revealed. Without this, a
 * 3,000-character answer is fed to remark + remark-gfm on every reveal frame.
 *
 * A split point is a blank line that unambiguously ends a top-level block.
 * Blank lines inside a fenced code block are not split points, and neither is a
 * blank line before a list item or an indented continuation: splitting there
 * would restart ordered-list numbering or break a loose list apart. The final
 * answer (typing done) is never split, so its markdown is always complete.
 */
export interface StreamingMarkdownParts {
  /** Blocks that are finished; safe to memoize. */
  readonly prefix: string;
  /** The block still being written; reparsed as it grows. */
  readonly tail: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/;
/** Two or more leading spaces continue a list item or start an indented code block. */
const INDENTED = /^ {2,}/;

const indented = (line: string) => INDENTED.test(line);

export const splitStreamingMarkdown = (text: string): StreamingMarkdownParts => {
  const lines = text.split("\n");
  const starts: Array<number> = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }

  // The first non-blank line after each line, so a blank line knows what follows it.
  const nextContent: Array<number> = Array.from({ length: lines.length }, () => -1);
  let next = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    nextContent[index] = next;
    if ((lines[index] ?? "").trim() !== "") next = index;
  }

  let fence: { readonly char: string; readonly length: number } | null = null;
  let boundary = 0;
  for (const [index, line] of lines.entries()) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      const marker = close?.[1] ?? "";
      if (marker.startsWith(fence.char) && marker.length >= fence.length) fence = null;
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "```";
      fence = { char: marker[0] ?? "`", length: marker.length };
      continue;
    }

    if (line.trim() !== "") continue;
    const following = nextContent[index] ?? -1;
    if (following === -1) continue;
    const nextLine = lines[following] ?? "";
    // Before a list item or an indented block the blank line may not end the
    // block: splitting would restart numbering or loosen a list.
    if (LIST_ITEM.test(nextLine) || indented(nextLine)) continue;
    const start = starts[following] ?? 0;
    if (text.slice(0, start).trim() === "") continue;
    boundary = start;
  }

  return boundary === 0 ? { prefix: "", tail: text } : { prefix: text.slice(0, boundary), tail: text.slice(boundary) };
};

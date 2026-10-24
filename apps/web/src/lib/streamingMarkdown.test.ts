import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "./streamingMarkdown.ts";

describe("splitStreamingMarkdown", () => {
  it("keeps finished paragraphs in the memoized prefix and only the last block in the tail", () => {
    expect(splitStreamingMarkdown("Satu.\n\nDua.\n\nTiga")).toEqual({
      prefix: "Satu.\n\nDua.\n\n",
      tail: "Tiga",
    });
  });

  it("never splits inside a fenced code block, even across blank lines", () => {
    const { prefix, tail } = splitStreamingMarkdown("Intro\n\n```sql\nSELECT 1\n\nFROM pasien\n```\n\nOut");
    expect(tail).toBe("Out");
    expect(prefix.endsWith("```\n\n")).toBe(true);
  });

  it("does not split before a list item, so numbering and looseness stay intact", () => {
    expect(splitStreamingMarkdown("1. satu\n\n2. dua\n\nPenutup")).toEqual({
      prefix: "1. satu\n\n2. dua\n\n",
      tail: "Penutup",
    });
    expect(splitStreamingMarkdown("1. satu\n\n2. dua")).toEqual({ prefix: "", tail: "1. satu\n\n2. dua" });
  });

  it("does not split before an indented list continuation", () => {
    const text = "Langkah:\n\n1. satu\n\n   lanjutan\n\n2. dua";
    expect(splitStreamingMarkdown(text).tail).toBe(text);
  });

  it("handles tilde fences and CRLF line endings", () => {
    expect(splitStreamingMarkdown("Satu.\r\n\r\nDua.")).toEqual({ prefix: "Satu.\r\n\r\n", tail: "Dua." });
    expect(splitStreamingMarkdown("Intro\n\n~~~\na\n\nb\n~~~\n\nOut").tail).toBe("Out");
  });

  it("waits for the following block before splitting off a trailing blank line", () => {
    expect(splitStreamingMarkdown("Satu.\n\n")).toEqual({ prefix: "", tail: "Satu.\n\n" });
  });

  it("does not split when everything so far is whitespace", () => {
    expect(splitStreamingMarkdown("\n\nDua.")).toEqual({ prefix: "", tail: "\n\nDua." });
  });
});

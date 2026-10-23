/**
 * Splits an investigation answer into the sections the prompt asks for:
 * **Yang dicek**, **Diagnosis**, **Saran perbaikan**. Text before the first
 * section is the summary. Missing sections are empty.
 */
export interface AnswerSections {
  readonly intro: string;
  readonly checked: string;
  readonly diagnosis: string;
  readonly suggestion: string;
}

const HEADINGS: ReadonlyArray<readonly [keyof Omit<AnswerSections, "intro">, RegExp]> = [
  ["checked", /^(?:#{1,4}[ \t]*|\*\*)?[ \t]*Yang dicek[ \t]*(?:\*\*)?[ \t]*[:–-]?[ \t]*(?:\*\*)?/im],
  ["diagnosis", /^(?:#{1,4}[ \t]*|\*\*)?[ \t]*Diagnosis[ \t]*(?:\*\*)?[ \t]*[:–-]?[ \t]*(?:\*\*)?/im],
  ["suggestion", /^(?:#{1,4}[ \t]*|\*\*)?[ \t]*Saran perbaikan[ \t]*(?:\*\*)?[ \t]*[:–-]?[ \t]*(?:\*\*)?/im],
];

export const splitAnswer = (text: string): AnswerSections => {
  const found = HEADINGS.flatMap(([key, pattern]) => {
    const match = pattern.exec(text);
    return match ? [{ key, start: match.index, end: match.index + match[0].length }] : [];
  }).toSorted((a, b) => a.start - b.start);

  const result: Record<keyof AnswerSections, string> = { intro: "", checked: "", diagnosis: "", suggestion: "" };
  result.intro = text.slice(0, found[0]?.start ?? text.length).trim();
  found.forEach((section, i) => {
    result[section.key] = text.slice(section.end, found[i + 1]?.start ?? text.length).trim();
  });
  return result;
};

/** RM number mentioned in a complaint, e.g. "Pasien RM 012345 ..." or "no. RM: 012345". */
export const rmFromText = (text: string): string | undefined =>
  /\b(?:RM|rekam medis)\b[\s.:#-]*(?:no\.?\s*)?(\d{4,15})/i.exec(text)?.[1];

/** RM number used by the agent's tool calls or found in their results. */
export const rmFromSteps = (steps: ReadonlyArray<{ readonly input: unknown; readonly output: unknown }>): string | undefined => {
  for (const step of steps) {
    const input = step.input as Record<string, unknown> | null;
    if (input && typeof input["noRkmMedis"] === "string") return input["noRkmMedis"];
  }
  for (const step of steps) {
    const match = /"no_rkm_medis":"([^"]+)"/.exec(JSON.stringify(step.output ?? null));
    if (match?.[1]) return match[1];
  }
  return undefined;
};

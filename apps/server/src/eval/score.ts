/**
 * Scores one finished eval run against its scenario. Pure: the runner gives
 * it the final text, the tools that ran and the render blocks; this decides
 * pass/fail and writes one readable reason per expectation.
 *
 * The assertions are about facts, not wording: the expected tool ran, the
 * answer contains the right number or name, and no protected value leaked.
 */
import type { RenderBlock } from "@simha/shared";
import type { Scenario, ScenarioExpect } from "./scenarios.ts";

export interface ScenarioActual {
  readonly status: "ok" | "error";
  readonly error: string | null;
  readonly text: string;
  /** Tool names that finished successfully, in call order. */
  readonly tools: ReadonlyArray<string>;
  /** Tool names the model tried, including failed calls. */
  readonly attempted: ReadonlyArray<string>;
  readonly blocks: ReadonlyArray<RenderBlock>;
  readonly steps: number;
  readonly durationMs: number;
}

interface Expectation {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ScenarioResult extends ScenarioActual {
  readonly id: string;
  readonly question: string;
  readonly mode: Scenario["mode"];
  readonly user: Scenario["user"];
  readonly checks: ReadonlyArray<Expectation>;
  readonly passed: boolean;
}

const matches = (text: string, source: string) => new RegExp(source, "i").test(text);

/** Every number inside the block rows (charts, tables and stat cards). */
const blockNumbers = (blocks: ReadonlyArray<RenderBlock>): ReadonlyArray<number> =>
  blocks.flatMap((block) =>
    block.baris.flatMap((row) => Object.values(row).filter((value): value is number => typeof value === "number")),
  );

/** The answer as a person or a screenshot sees it: prose plus block titles and cells. */
const visibleText = (actual: ScenarioActual): string =>
  `${actual.text}\n${actual.blocks.map((block) => `${block.judul}\n${JSON.stringify(block.baris)}`).join("\n")}`;

const check = (name: string, ok: boolean, detail: string): Expectation => ({ name, ok, detail });

const expectTools = (expect: ScenarioExpect, actual: ScenarioActual): ReadonlyArray<Expectation> => {
  const checks: Array<Expectation> = [];
  for (const tool of expect.tools ?? []) {
    checks.push(
      check(
        `tool:${tool}`,
        actual.tools.includes(tool),
        actual.tools.includes(tool) ? `${tool} dipanggil.` : `${tool} tidak dipanggil (tools: ${actual.tools.join(", ") || "-"}).`,
      ),
    );
  }
  if (expect.toolsAny !== undefined && expect.toolsAny.length > 0) {
    const found = expect.toolsAny.filter((tool) => actual.tools.includes(tool));
    checks.push(
      check(
        "tool:salah-satu",
        found.length > 0,
        `${expect.toolsAny.join(" / ")}: ${found.length > 0 ? found.join(", ") : "tidak ada yang dipanggil"}.`,
      ),
    );
  }
  for (const tool of expect.forbidTools ?? []) {
    checks.push(
      check(
        `tool:dilarang:${tool}`,
        !actual.attempted.includes(tool),
        actual.attempted.includes(tool) ? `${tool} dipanggil, seharusnya tidak.` : `${tool} tidak dipanggil.`,
      ),
    );
  }
  return checks;
};

const expectAnswer = (expect: ScenarioExpect, actual: ScenarioActual): ReadonlyArray<Expectation> => {
  if (actual.status === "error") {
    return [check("jawaban", false, actual.error ?? "Run tidak selesai.")];
  }
  const checks: Array<Expectation> = [];
  const visible = visibleText(actual);
  for (const pattern of expect.answer ?? []) {
    checks.push(
      check(
        `jawaban:${pattern}`,
        matches(visible, pattern),
        matches(visible, pattern) ? `cocok dengan /${pattern}/i.` : `tidak cocok dengan /${pattern}/i.`,
      ),
    );
  }
  for (const pattern of expect.forbidAnswer ?? []) {
    checks.push(
      check(
        `jawaban:dilarang:${pattern}`,
        !matches(visible, pattern),
        matches(visible, pattern) ? `jawaban atau kartu memuat /${pattern}/i.` : `tidak memuat /${pattern}/i.`,
      ),
    );
  }
  return checks;
};

const expectBlocks = (expect: ScenarioExpect, actual: ScenarioActual): ReadonlyArray<Expectation> => {
  const checks: Array<Expectation> = [];
  const first = actual.blocks[0];

  if (expect.block !== undefined) {
    if (expect.block === "none") {
      checks.push(
        check("blok:none", actual.blocks.length === 0, actual.blocks.length === 0 ? "tidak ada blok." : `ada ${actual.blocks.length} blok.`),
      );
    } else {
      checks.push(
        check(
          `blok:${expect.block}`,
          first?.tipe === expect.block,
          first === undefined ? "tidak ada blok hasil." : `blok pertama: ${first.tipe}.`,
        ),
      );
    }
  }

  if (expect.rows !== undefined) {
    checks.push(
      check(
        "blok:baris",
        first?.baris.length === expect.rows,
        first === undefined ? "tidak ada blok." : `${first.baris.length} baris (diharapkan ${expect.rows}).`,
      ),
    );
  }

  if (expect.numbers !== undefined && expect.numbers.length > 0) {
    const numbers = blockNumbers(actual.blocks);
    const missing = expect.numbers.filter((expected) => !numbers.some((value) => Math.abs(value - expected) < 1e-9));
    checks.push(
      check(
        "blok:angka",
        missing.length === 0,
        missing.length === 0 ? `${expect.numbers.join(", ")} ditemukan.` : `angka tidak ditemukan: ${missing.join(", ")} (isi: ${numbers.join(", ") || "-"}).`,
      ),
    );
  }

  return checks;
};

/** All expectations, plus the run-level ones. */
export const scoreScenario = (scenario: Scenario, actual: ScenarioActual): ScenarioResult => {
  const checks: Array<Expectation> = [];
  checks.push(
    check(
      "run:selesai",
      actual.status === "ok",
      actual.status === "ok" ? "Run selesai." : (actual.error ?? "Run gagal."),
    ),
  );
  if (actual.status === "ok" && scenario.expect.answerRequired !== false) {
    checks.push(check("run:jawaban", actual.text.trim() !== "", actual.text.trim() === "" ? "Jawaban kosong." : "Ada jawaban."));
  }
  if (scenario.expect.maxSteps !== undefined) {
    checks.push(
      check(
        "run:langkah",
        actual.steps <= scenario.expect.maxSteps,
        `${actual.steps} langkah (maks ${scenario.expect.maxSteps}).`,
      ),
    );
  }

  checks.push(...expectTools(scenario.expect, actual));
  checks.push(...expectAnswer(scenario.expect, actual));
  checks.push(...expectBlocks(scenario.expect, actual));

  return {
    ...actual,
    id: scenario.id,
    question: scenario.question,
    mode: scenario.mode,
    user: scenario.user,
    checks,
    passed: checks.every((item) => item.ok),
  };
};

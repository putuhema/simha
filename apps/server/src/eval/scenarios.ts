/**
 * The agent test set (M5.2): fixed questions with known answers, scored
 * against a real provider so a model or prompt change can be measured before
 * staff see it.
 *
 * Scenarios are JSON files in `evals/scenarios/`. They are written against the
 * synthetic test database by default (`pnpm eval`), never real patient data.
 * A scenario names the tool calls it expects and the facts the answer must
 * contain; it does not compare prose word for word, so a better answer still
 * passes.
 */
import { readdir, readFile } from "node:fs/promises";
import * as NodePath from "node:path";

type EvalMode = "tanya" | "investigasi";
type EvalUser = "admin" | "staff";

export interface ScenarioExpect {
  /** Every tool must have been called successfully at least once. */
  readonly tools?: ReadonlyArray<string>;
  /** At least one of these tools must have been called successfully. */
  readonly toolsAny?: ReadonlyArray<string>;
  /** None of these tools may be attempted, successful or not. */
  readonly forbidTools?: ReadonlyArray<string>;
  /** Regexes (case-insensitive) the final answer must match. */
  readonly answer?: ReadonlyArray<string>;
  /** Regexes that must not match the final answer. */
  readonly forbidAnswer?: ReadonlyArray<string>;
  /** The type of the first render block, or "none" when there must be no block. */
  readonly block?: "table" | "bar" | "line" | "pie" | "stat" | "list" | "none";
  /** Exact number of rows in the block (after the tool built it). */
  readonly rows?: number;
  /** Every number must appear among the block's values (e.g. 3 and 2 in a chart). */
  readonly numbers?: ReadonlyArray<number>;
  /** Inclusive bound on model turns used. */
  readonly maxSteps?: number;
  /** The run must finish with an answer (the default when any expectation is set). */
  readonly answerRequired?: boolean;
}

export interface Scenario {
  /** Stable id, used in reports and `--scenario`. */
  readonly id: string;
  readonly question: string;
  readonly mode: EvalMode;
  readonly user: EvalUser;
  /** What this scenario is meant to prove, for the report. */
  readonly notes: string;
  readonly expect: ScenarioExpect;
}

const MODES: ReadonlyArray<string> = ["tanya", "investigasi"];
const USERS: ReadonlyArray<string> = ["admin", "staff"];
const BLOCKS: ReadonlyArray<string> = ["table", "bar", "line", "pie", "stat", "list", "none"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, where: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${where} harus teks yang tidak kosong.`);
  return value;
};

const textArray = (value: unknown, where: string): ReadonlyArray<string> => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${where} harus array teks.`);
  return value.map((item, index) => text(item, `${where}[${index}]`));
};

const numberArray = (value: unknown, where: string): ReadonlyArray<number> => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error(`${where} harus array angka.`);
  }
  return value as ReadonlyArray<number>;
};

/** Checks that every `answer`/`forbidAnswer` entry is a valid regex, so a bad scenario fails before spending tokens. */
const regexes = (values: ReadonlyArray<string>, where: string): ReadonlyArray<string> => {
  for (const value of values) {
    try {
      void RegExp(value);
    } catch {
      throw new Error(`${where} berisi regex tidak valid: ${value}`);
    }
  }
  return values;
};

const positiveInt = (value: unknown, where: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${where} harus bilangan bulat > 0.`);
  return value;
};

const parseExpect = (value: unknown, where: string): ScenarioExpect => {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${where} harus objek.`);

  const block = value["block"];
  if (block !== undefined && (typeof block !== "string" || !BLOCKS.includes(block))) {
    throw new Error(`${where}.block harus salah satu: ${BLOCKS.join(", ")}.`);
  }

  const rows = positiveInt(value["rows"], `${where}.rows`);
  const maxSteps = positiveInt(value["maxSteps"], `${where}.maxSteps`);
  return {
    tools: textArray(value["tools"], `${where}.tools`),
    toolsAny: textArray(value["toolsAny"], `${where}.toolsAny`),
    forbidTools: textArray(value["forbidTools"], `${where}.forbidTools`),
    answer: regexes(textArray(value["answer"], `${where}.answer`), `${where}.answer`),
    forbidAnswer: regexes(textArray(value["forbidAnswer"], `${where}.forbidAnswer`), `${where}.forbidAnswer`),
    ...(block === undefined ? {} : { block: block as NonNullable<ScenarioExpect["block"]> }),
    ...(rows === undefined ? {} : { rows }),
    numbers: numberArray(value["numbers"], `${where}.numbers`),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(value["answerRequired"] === undefined ? {} : { answerRequired: value["answerRequired"] === true }),
  };
};

/** Parses one scenario object; throws a message naming the file and field. */
export const parseScenario = (value: unknown, where: string): Scenario => {
  if (!isRecord(value)) throw new Error(`${where} harus objek.`);
  const id = text(value["id"], `${where}.id`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`${where}.id harus kebab-case: ${id}`);
  const mode = text(value["mode"], `${where}.mode`);
  if (!MODES.includes(mode)) throw new Error(`${where}.mode harus tanya atau investigasi.`);
  const user = text(value["user"], `${where}.user`);
  if (!USERS.includes(user)) throw new Error(`${where}.user harus admin atau staff.`);
  return {
    id,
    question: text(value["question"], `${where}.question`),
    mode: mode as EvalMode,
    user: user as EvalUser,
    notes: text(value["notes"], `${where}.notes`),
    expect: parseExpect(value["expect"], `${where}.expect`),
  };
};

/** `evals/scenarios` at the repository root. */
const defaultScenarioDir = NodePath.resolve(import.meta.dirname, "..", "..", "..", "..", "evals", "scenarios");

/** Reads every `*.json` file (an array of scenarios) from `dir`, sorted by id. */
export const loadScenarios = async (dir: string = defaultScenarioDir): Promise<ReadonlyArray<Scenario>> => {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).toSorted();
  const scenarios: Array<Scenario> = [];
  for (const file of files) {
    const path = NodePath.join(dir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new Error(`${path}: bukan JSON yang valid (${error instanceof Error ? error.message : String(error)}).`, {
        cause: error,
      });
    }
    if (!Array.isArray(parsed)) throw new Error(`${path}: harus berisi array skenario.`);
    parsed.forEach((item, index) => scenarios.push(parseScenario(item, `${file}[${index}]`)));
  }
  const ids = scenarios.map((scenario) => scenario.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw new Error(`Id skenario dipakai dua kali: ${duplicate}`);
  if (scenarios.length === 0) throw new Error(`Tidak ada skenario di ${dir}.`);
  return scenarios.toSorted((a, b) => a.id.localeCompare(b.id));
};

/**
 * Fails when the checked-in app map no longer matches the Khanza source it was
 * generated from, or when index.json disagrees with itself.
 *
 * Fast on purpose: it reads git HEAD and index.json; it does not re-parse the
 * 4k Java files (that is `pnpm extract-khanza-app --check`). Skipped, with a
 * message, when the source tree is not on this machine, so `pnpm verify` works
 * for people who only have this repo.
 *
 *   pnpm check:app-map
 *   pnpm check:app-map --src /path/to/khanza
 *   KHANZA_SRC_DIR=/path/to/khanza pnpm check:app-map
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";
import { parseAppIndex } from "@simha/tools";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { src: { type: "string" } } });
const sourceRoot = NodePath.resolve(
  values.src ?? process.env["KHANZA_SRC_DIR"] ?? NodePath.join(homedir(), "work/simrsmt"),
);
const indexPath = NodePath.join(repoRoot, "docs/khanza-app/index.json");

const head = (() => {
  try {
    return execFileSync("git", ["-C", sourceRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
})();

if (head === null) {
  console.log(`check:app-map: skipped — no Khanza git checkout at ${sourceRoot}.`);
  console.log("  Pass --src or set KHANZA_SRC_DIR on a machine that has the source.");
  process.exit(0);
}

const text = await readFile(indexPath, "utf8").catch(() => "");
if (text === "") {
  console.error("check:app-map: docs/khanza-app/index.json is missing. Run `pnpm extract-khanza-app`.");
  process.exit(1);
}

interface IndexSource {
  readonly commit?: string;
  readonly generatedAt?: string;
  readonly groups?: number;
  readonly menuEntries?: number;
  readonly forms?: number;
}

const raw = JSON.parse(text) as { source?: IndexSource };
const docs = parseAppIndex(text, repoRoot);
const problems: string[] = [];

if (raw.source?.commit !== head) {
  problems.push(`index.json is from commit ${raw.source?.commit ?? "(none)"}, the source is at ${head}`);
}

// The counts in index.json are written by the generator; a mismatch means the
// file was edited or truncated, which the runtime map loader cannot detect.
const counts: ReadonlyArray<readonly [string, number | undefined, number]> = [
  ["groups", raw.source?.groups, new Set(docs.menus.map((menu) => menu.groupLetter)).size],
  ["menu buttons", raw.source?.menuEntries, docs.menus.length],
  ["forms", raw.source?.forms, docs.forms.length],
];
for (const [label, stated, actual] of counts) {
  if (stated !== undefined && stated !== actual) problems.push(`${label}: index.json says ${stated}, parsed ${actual}`);
}

if (problems.length > 0) {
  console.error("check:app-map: docs/khanza-app is stale or inconsistent:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("Run `pnpm extract-khanza-app` and commit docs/khanza-app/.");
  process.exit(1);
}

const dibuat = raw.source?.generatedAt === undefined ? "" : ` (${raw.source.generatedAt.slice(0, 10)})`;
console.log(
  `check:app-map: ok — ${docs.menus.length} buttons, ${docs.forms.length} forms, commit ${head}${dibuat}.`,
);

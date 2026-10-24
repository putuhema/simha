/**
 * The agent test set (M5.2): run fixed scenarios against a real provider and
 * score them.
 *
 *   pnpm eval                       # synthetic test DB (default; starts MariaDB)
 *   pnpm eval -- --live             # the Khanza DB from .env (read-only user)
 *   pnpm eval -- --scenario=safety-nik
 *   pnpm eval -- --list             # ids and questions, no AI call
 *   pnpm eval -- --json             # machine-readable report on stdout
 *
 * The default DB is the throwaway synthetic one: the same schema as practice,
 * no patient data leaves the hospital. `--live` uses the configured read-only
 * Khanza user, so it is safe for data but sends real questions to the AI
 * provider exactly like the app does.
 *
 * Results are written to data/eval-results/ and the exit code is 1 when any
 * scenario fails, so a provider/model/prompt change can gate a release.
 */
import { NodeFileSystem } from "@effect/platform-node";
import { LlmClient, LlmClientLive } from "@simha/llm";
import {
  AppDocsLive,
  AuditLogMemory,
  Berkas,
  FixStoreLive,
  KhanzaReadLive,
  KnowledgeStoreLive,
  makeBerkas,
  pacsLayer,
  ResultStoreLive,
  SchemaDocsLive,
  khanzaReadLayer,
} from "@simha/tools";
import { startTestDb } from "@simha/tools/testing/db";
import { Duration, Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { mkdir, writeFile } from "node:fs/promises";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";
import { AgentLive } from "../agent/Agent.ts";
import { SystemPromptLive } from "../agent/prompt.ts";
import { StoreLive } from "../store.ts";
import { runScenario } from "./runner.ts";
import { loadScenarios, type Scenario } from "./scenarios.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..", "..", "..");
const resultsDir = NodePath.join(repoRoot, "data", "eval-results");

const { values } = parseArgs({
  // `pnpm eval -- --live` can leave the separator in argv.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    live: { type: "boolean", default: false },
    scenario: { type: "string", multiple: true },
    json: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    out: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const EXIT = { ok: 0, failed: 1, setup: 2 } as const;

const usage = `Simha agent test set (M5.2)

  pnpm eval                        run every scenario on the synthetic test DB
  pnpm eval -- --live              run against the Khanza DB in .env (read-only user)
  pnpm eval -- --scenario=<id>     only that scenario (repeatable)
  pnpm eval -- --list              list scenarios without calling the AI
  pnpm eval -- --json              print the full report as JSON
  pnpm eval -- --out=<path>        write the report there

The AI provider comes from .env (LLM_PROVIDER, LLM_MODEL); a fake provider is
refused because it cannot score answer quality.`;

const slug = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9._-]+/g, "-").replaceAll(/^-|-$/g, "");

const stamp = () => new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");

const selectScenarios = (scenarios: ReadonlyArray<Scenario>, ids: ReadonlyArray<string>): ReadonlyArray<Scenario> => {
  if (ids.length === 0) return scenarios;
  const unknown = ids.filter((id) => !scenarios.some((scenario) => scenario.id === id));
  if (unknown.length > 0) {
    throw new Error(`Skenario tidak ada: ${unknown.join(", ")}. Pilih salah satu: ${scenarios.map((scenario) => scenario.id).join(", ")}`);
  }
  return scenarios.filter((scenario) => ids.includes(scenario.id));
};

const main = async (): Promise<number> => {
  if (values.help) {
    console.log(usage);
    return EXIT.ok;
  }

  const all = await loadScenarios();
  if (values.list) {
    for (const scenario of all) {
      console.log(`${scenario.id.padEnd(28)} ${scenario.mode.padEnd(12)} ${scenario.question}`);
    }
    return EXIT.ok;
  }
  const scenarios = selectScenarios(all, values.scenario ?? []);

  // The read pool: synthetic DB by default, or the configured Khanza DB.
  const test = values.live ? null : await startTestDb();
  const db = test?.info ?? null;
  if (!values.live && db === null) {
    console.error(
      "Tidak ada database uji. Jalankan `docker compose up -d` dan set KHANZA_TEST_DB_HOST/PORT/PASS, " +
        "atau instal MariaDB lokal. Untuk database Khanza asli, pakai `pnpm eval -- --live`.",
    );
    await test?.stop();
    return EXIT.setup;
  }

  const read = db
    ? khanzaReadLayer({
        connection: {
          host: db.host,
          port: db.port,
          database: db.database,
          username: db.readUser,
          password: Redacted.make(db.readPass),
        },
        timeout: Duration.seconds(10),
      })
    : KhanzaReadLive;

  const app = Layer.mergeAll(AgentLive).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        StoreLive,
        FixStoreLive,
        KnowledgeStoreLive,
        ResultStoreLive,
        SchemaDocsLive,
        AppDocsLive,
        SystemPromptLive,
        LlmClientLive,
        pacsLayer({ url: "", user: "", pass: Redacted.make("") }),
        Layer.succeed(Berkas, makeBerkas({ dir: "" })),
        read,
      ),
    ),
    Layer.provideMerge(AuditLogMemory),
    Layer.provide(NodeFileSystem.layer),
  );

  const runtime = ManagedRuntime.make(app);
  try {
    const info = await runtime.runPromise(Effect.map(LlmClient, (client) => client.info));
    if (info.adapter === "fake") {
      console.error("LLM_PROVIDER=fake tidak bisa dipakai untuk uji kualitas. Isi provider dan model di .env.");
      return EXIT.setup;
    }

    const startedAt = new Date().toISOString();
    if (!values.json) {
      console.log(`Simha agent test set — ${info.provider} / ${info.model} — ${db ? "test DB (synthetic)" : "live Khanza DB"}`);
      console.log(`${scenarios.length} skenario\n`);
    }

    const results = [];
    for (const [index, scenario] of scenarios.entries()) {
      if (!values.json) process.stdout.write(`[${index + 1}/${scenarios.length}] ${scenario.id}… `);
      const result = await runtime.runPromise(runScenario(scenario));
      results.push(result);
      if (!values.json) {
        console.log(result.passed ? "LULUS" : "GAGAL");
        for (const failed of result.checks.filter((item) => !item.ok)) {
          console.log(`      - ${failed.name}: ${failed.detail}`);
        }
      }
    }

    // A test set that can write is worse than no test set.
    const safety = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [writes] = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM queries WHERE pool = 'write'`;
        const [fixes] = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM fixes WHERE status IN ('approved', 'applied')`;
        return { writes: Number(writes?.n ?? 0), fixes: Number(fixes?.n ?? 0) };
      }),
    );

    const passed = results.filter((result) => result.passed).length;
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      database: db ? "test" : "live",
      provider: info.provider,
      model: info.model,
      passed,
      total: results.length,
      safe: safety.writes === 0 && safety.fixes === 0,
      results,
    };

    const outPath =
      values.out === undefined
        ? NodePath.join(resultsDir, `${stamp()}-${slug(info.provider)}-${slug(info.model)}.json`)
        : NodePath.resolve(values.out);
    await mkdir(NodePath.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n${passed}/${results.length} lulus${passed === results.length ? "" : ` · ${results.length - passed} gagal`}`);
      console.log(
        report.safe
          ? "Aman: tidak ada query write dan tidak ada perbaikan yang dijalankan."
          : `TIDAK AMAN: ${safety.writes} query write, ${safety.fixes} perbaikan disetujui/dijalankan.`,
      );
      console.log(`Laporan: ${NodePath.relative(repoRoot, outPath)}`);
    }
    return passed === results.length && report.safe ? EXIT.ok : EXIT.failed;
  } finally {
    await runtime.dispose();
    await test?.stop();
  }
};

main()
  .then((code) => {
    // exitCode (not exit) lets stdout flush, which matters for --json in a pipe.
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT.setup;
  });

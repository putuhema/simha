/**
 * Routine-check history in the audit DB: the newest report comes back whole,
 * samples survive the JSON round trip, and old runs are pruned so a scheduled
 * check cannot grow the database forever.
 */
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { AuditLogMemory } from "../src/audit/AuditLog.ts";
import { CheckStore, CheckStoreLive, KEEP_CHECK_RUNS } from "../src/checks/CheckStore.ts";
import type { NewCheckRun } from "../src/checks/CheckStore.ts";

const layer = CheckStoreLive.pipe(Layer.provideMerge(AuditLogMemory));
const run = <A, E>(effect: Effect.Effect<A, E, CheckStore | SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));

const report = (index: number, problems = index % 2 === 0): NewCheckRun => ({
  id: `run-${String(index).padStart(3, "0")}`,
  startedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  finishedAt: new Date(Date.UTC(2026, 0, 1, 0, index, 5)).toISOString(),
  trigger: "schedule",
  actor: null,
  status: "ok",
  error: null,
  durationMs: 5000,
  masalah: problems ? 1 : 0,
  gagal: 0,
  checks: [
    {
      id: "kamar-ganda",
      title: "Dua kamar aktif untuk satu kunjungan",
      severity: "kritis",
      description: "Satu no_rawat punya lebih dari satu kamar aktif.",
      advice: "Tutup kamar yang lama.",
      status: problems ? "masalah" : "ok",
      count: problems ? 2 : 0,
      sample: problems
        ? [{ noRawat: "2026/10/21/000002", noRm: "000002", pasien: "SITI AMINAH", keterangan: "2 kamar aktif: MEL-02, MAW-01" }]
        : [],
      error: null,
      durationMs: 40,
    },
  ],
});

describe("CheckStore", () => {
  it("saves a run and returns it as the latest report", async () => {
    const saved = await run(
      Effect.gen(function* () {
        const store = yield* CheckStore;
        yield* store.save(report(2));
        return yield* store.latest();
      }),
    );
    expect(saved).toMatchObject({
      id: "run-002",
      trigger: "schedule",
      masalah: 1,
      gagal: 0,
      checks: [
        {
          id: "kamar-ganda",
          status: "masalah",
          count: 2,
          severity: "kritis",
          sample: [{ noRawat: "2026/10/21/000002", noRm: "000002", pasien: "SITI AMINAH" }],
          error: null,
        },
      ],
    });
  });

  it("returns the newest run first and keeps a short history", async () => {
    const result = await run(
      Effect.gen(function* () {
        const store = yield* CheckStore;
        for (let index = 1; index <= 5; index++) yield* store.save(report(index));
        return { latest: yield* store.latest(), history: yield* store.history() };
      }),
    );
    expect(result.latest?.id).toBe("run-005");
    expect(result.history.map((item) => item.id)).toEqual(["run-005", "run-004", "run-003", "run-002", "run-001"]);
  });

  it("prunes runs and their results beyond the cap", async () => {
    const result = await run(
      Effect.gen(function* () {
        const store = yield* CheckStore;
        for (let index = 1; index <= KEEP_CHECK_RUNS + 5; index++) yield* store.save(report(index));
        const history = yield* store.history();
        const client = yield* SqlClient.SqlClient;
        const [rows] = yield* client<{ n: number }>`SELECT COUNT(*) AS n FROM check_results`;
        return { history, results: Number(rows?.n ?? 0) };
      }),
    );
    expect(result.history).toHaveLength(20);
    expect(result.results).toBe(KEEP_CHECK_RUNS);
  });
});

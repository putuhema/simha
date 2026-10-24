/**
 * Routine checks against the synthetic test DB. The fixtures contain one of
 * each known problem (two active rooms, a closed registration still in a room,
 * a room marked ISI with nobody in it, a stay without DPJP/diagnosis) plus
 * clean rows that must not be reported.
 */
import { describe, expect, layer } from "@effect/vitest";
import { test } from "vitest";
import { Effect } from "effect";
import { ROUTINE_CHECKS } from "../src/checks/definitions.ts";
import { runRoutineChecks } from "../src/checks/runChecks.ts";
import { readTestLayer, testDb } from "./helpers.ts";

describe("check definitions", () => {
  test("every check has a unique id and explains itself", () => {
    const ids = ROUTINE_CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const check of ROUTINE_CHECKS) {
      expect(check.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(check.title.length).toBeGreaterThan(8);
      expect(check.description.length).toBeGreaterThan(20);
      expect(check.advice.length).toBeGreaterThan(20);
    }
  });
});

describe.skipIf(testDb === null)("routine checks on the test database", () => {
  if (testDb === null) return;

  layer(readTestLayer(testDb), { excludeTestServices: true })((it) => {
    it.effect("finds the planted problems and leaves clean visits alone", () =>
      Effect.gen(function* () {
        const report = yield* runRoutineChecks;
        const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));

        expect(report.checks).toHaveLength(ROUTINE_CHECKS.length);
        expect(report.gagal).toBe(0);
        expect(report.masalah).toBe(5);

        expect(byId["kamar-ganda"]).toMatchObject({
          status: "masalah",
          count: 1,
          severity: "kritis",
          sample: [
            {
              noRawat: "2026/10/21/000002",
              noRm: "000002",
              pasien: "SITI AMINAH",
            },
          ],
        });
        expect(byId["kamar-ganda"]?.sample[0]?.keterangan).toContain("MEL-02");
        expect(byId["kamar-ganda"]?.sample[0]?.keterangan).toContain("MAW-01");

        // The "tidak bisa pulang" case: registration finished, room still open.
        expect(byId["pulang-kamar-aktif"]).toMatchObject({
          status: "masalah",
          count: 1,
          sample: [{ noRawat: "2026/10/23/000006", noRm: "000003", pasien: "BUDI_HARTONO" }],
        });
        expect(byId["pulang-kamar-aktif"]?.sample[0]?.keterangan).toContain("'Sudah'");

        // MAW-02 is ISI but nobody is in it.
        expect(byId["kamar-status-salah"]).toMatchObject({
          status: "masalah",
          count: 1,
          sample: [{ noRawat: null, noRm: null, pasien: null }],
        });
        expect(byId["kamar-status-salah"]?.sample[0]?.keterangan).toContain("MAW-02");

        expect(byId["ranap-tanpa-diagnosa"]).toMatchObject({
          status: "masalah",
          count: 1,
          sample: [{ noRawat: "2026/10/23/000006" }],
        });
        expect(byId["ranap-tanpa-dpjp"]).toMatchObject({
          status: "masalah",
          count: 1,
          sample: [{ noRawat: "2026/10/23/000006" }],
        });

        // Clean: every SEP is closed and every open Ranap registration has a room.
        expect(byId["sep-belum-ditutup"]).toMatchObject({ status: "ok", count: 0, sample: [] });
        expect(byId["ranap-tanpa-kamar"]).toMatchObject({ status: "ok", count: 0, sample: [] });

        for (const check of report.checks) {
          expect(check.sample.length).toBeLessThanOrEqual(20);
          expect(check.durationMs).toBeGreaterThanOrEqual(0);
          expect(check.error).toBeNull();
        }
      }),
    );

    it.effect("counts beyond the 20-row sample", () =>
      Effect.gen(function* () {
        // The sample is capped, but a check's count comes from its own query.
        const report = yield* runRoutineChecks;
        const checks = report.checks.filter((check) => check.status === "masalah");
        expect(checks.every((check) => check.count >= check.sample.length)).toBe(true);
      }),
    );
  });
});

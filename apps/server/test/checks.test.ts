/**
 * Pemeriksaan data over HTTP: the newest report, the history, admin-only
 * "run now", and that a run stays read-only (no write-pool query, no fix).
 */
import type { CheckReport, CheckRun } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { makeTestApp, testDb } from "./harness.ts";

describe.skipIf(testDb === null)("routine checks API", () => {
  it("returns an empty report before the first run", async () => {
    const app = makeTestApp([]);
    try {
      const response = await app.call("GET", "/checks");
      expect(response.status).toBe(200);
      expect((await response.json()) as CheckReport).toEqual({ latest: null, history: [] });
    } finally {
      await app.dispose();
    }
  });

  it("runs the checks as an admin, stores the report and stays read-only", async () => {
    const app = makeTestApp([]);
    try {
      const denied = await app.callAs("it-terbatas", "POST", "/checks/run");
      expect(denied.status).toBe(403);

      const runResponse = await app.call("POST", "/checks/run");
      expect(runResponse.status).toBe(201);
      const run = (await runResponse.json()) as CheckRun;
      expect(run).toMatchObject({ trigger: "manual", actor: "it-budi", status: "ok", gagal: 0 });
      // Other server tests share the synthetic DB and may add rows, so this
      // asserts the planted problem is found, not the exact global count.
      expect(run.checks).toHaveLength(7);
      expect(run.masalah).toBeGreaterThanOrEqual(5);
      const duplicate = run.checks.find((check) => check.id === "kamar-ganda");
      expect(duplicate).toMatchObject({ severity: "kritis", status: "masalah" });
      expect(duplicate?.count).toBeGreaterThanOrEqual(1);
      expect(duplicate?.sample).toEqual(
        expect.arrayContaining([expect.objectContaining({ noRawat: "2026/10/21/000002", noRm: "000002", pasien: "SITI AMINAH" })]),
      );

      const report = (await (await app.call("GET", "/checks")).json()) as CheckReport;
      expect(report.latest?.id).toBe(run.id);
      expect(report.latest?.checks).toHaveLength(7);
      expect(report.history).toHaveLength(1);
      expect(report.history[0]).toMatchObject({ id: run.id, actor: "it-budi", gagal: 0 });
      expect(report.history[0]?.masalah).toBeGreaterThanOrEqual(5);

      // The checks only read: no write-pool query and no proposed fix.
      const writes = await app.audit<{ n: number }>("SELECT COUNT(*) AS n FROM queries WHERE pool = 'write'");
      expect(Number(writes[0]?.n ?? 0)).toBe(0);
      const fixes = await app.audit<{ n: number }>("SELECT COUNT(*) AS n FROM fixes");
      expect(Number(fixes[0]?.n ?? 0)).toBe(0);
    } finally {
      await app.dispose();
    }
  });
});

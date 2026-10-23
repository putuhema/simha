/**
 * The discharge check against the synthetic test database. The interesting
 * cases are the two common data problems behind "tidak bisa pulang": two
 * active kamar_inap rows, and a registration already closed while the room is
 * still open.
 */
import { describe, expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { diagnosaPindahKamar } from "../src/diagnose/diagnosaPindahKamar.ts";
import { diagnosaPulang } from "../src/diagnose/diagnosaPulang.ts";
import { runTool } from "../src/tool.ts";
import { readTestLayer, testDb } from "./helpers.ts";

const problem = (result: { temuan: ReadonlyArray<{ cek: string; hasil: string; keterangan: string }> }, cek: string) =>
  result.temuan.find((t) => t.cek === cek && t.hasil === "masalah");

describe.skipIf(testDb === null)("diagnosaPulang", () => {
  if (testDb === null) return;

  layer(readTestLayer(testDb), { excludeTestServices: true })((it) => {
    it.effect("room move check sees the two active rooms", () =>
      Effect.gen(function* () {
        const result = yield* runTool(diagnosaPindahKamar, { noRawat: "2026/10/21/000002", kdKamarTujuan: "MAW-03" });
        expect(problem(result, "Kamar aktif")?.keterangan).toMatch(/2 baris kamar_inap aktif/);
        expect(result.jumlahMasalah).toBe(1);
      }),
    );

    it.effect("flags a stay with two active rooms", () =>
      Effect.gen(function* () {
        const result = yield* runTool(diagnosaPulang, { noRawat: "2026/10/21/000002" });
        expect(problem(result, "Kamar aktif")?.keterangan).toMatch(/2 kamar aktif.*MEL-02.*MAW-01/);
        expect(result.jumlahMasalah).toBe(1);
      }),
    );

    it.effect("flags a closed registration whose room is still active", () =>
      Effect.gen(function* () {
        const result = yield* runTool(diagnosaPulang, { noRawat: "2026/10/23/000006" });
        expect(problem(result, "Status registrasi")?.keterangan).toMatch(/stts = 'Sudah'.*masih aktif/);
        expect(problem(result, "Status registrasi")?.keterangan).toMatch(/Dirawat/);
        expect(result.jumlahMasalah).toBe(1);
      }),
    );

    it.effect("reports no problem for a normal active stay", () =>
      Effect.gen(function* () {
        const result = yield* runTool(diagnosaPulang, { noRawat: "2026/10/20/000001" });
        expect(result.jumlahMasalah).toBe(0);
        expect(result.temuan.find((t) => t.cek === "Kamar aktif")).toMatchObject({ hasil: "ok" });
      }),
    );

    it.effect("does not call an already discharged stay a billing problem", () =>
      Effect.gen(function* () {
        const result = yield* runTool(diagnosaPulang, { noRawat: "2026/09/15/000004" });
        expect(result.jumlahMasalah).toBe(0);
        expect(result.temuan.find((t) => t.cek === "Status registrasi")).toMatchObject({ hasil: "info" });
        expect(result.temuan.find((t) => t.cek === "Billing")).toMatchObject({ hasil: "info" });
      }),
    );
  });
});

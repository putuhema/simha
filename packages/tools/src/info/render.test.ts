import { describe, expect, it } from "vitest";
import { buildBlock, RenderRejected, type RenderSpec } from "./render.ts";
import type { QueryResult } from "./ResultStore.ts";

const result = (rows: QueryResult["rows"]): QueryResult => ({
  id: "q1",
  sessionId: null,
  reason: "test",
  sqlOriginal: "SELECT ...",
  sqlFinal: "SELECT ...\nLIMIT 501",
  columns: Object.keys(rows[0] ?? {}),
  rows,
  truncated: false,
});

const perPoli = result([
  { poli: "Poli Umum", jumlah: 3, rata: "1.50" },
  { poli: "Poli Gigi", jumlah: 2, rata: "2.00" },
]);

const rejection = (spec: RenderSpec, r: QueryResult) => {
  try {
    buildBlock(spec, r);
  } catch (error) {
    if (error instanceof RenderRejected) return error.message;
    throw error;
  }
  throw new Error("expected rejection");
};

describe("buildBlock", () => {
  it("bar: picks the text column as x and number columns as y, numbers converted", () => {
    const block = buildBlock({ tipe: "bar", judul: "Kunjungan per poli" }, perPoli, "b1");
    expect(block).toMatchObject({ id: "b1", tipe: "bar", x: "poli", y: ["jumlah", "rata"], queryId: "q1", sql: "SELECT ...\nLIMIT 501" });
    expect(block.baris[1]).toEqual({ poli: "Poli Gigi", jumlah: 2, rata: 2 });
  });

  it("uses the columns the AI names, and rejects unknown or non-number ones", () => {
    expect(buildBlock({ tipe: "pie", judul: "x", opsi: { x: "poli", y: ["jumlah"] } }, perPoli).y).toEqual(["jumlah"]);
    expect(rejection({ tipe: "bar", judul: "x", opsi: { y: ["total"] } }, perPoli)).toMatch(/"total" tidak ada.*poli, jumlah, rata/);
    expect(rejection({ tipe: "bar", judul: "x", opsi: { x: "jumlah", y: ["poli"] } }, perPoli)).toMatch(/bukan angka/);
    expect(rejection({ tipe: "pie", judul: "x" }, perPoli)).toMatch(/tepat satu kolom angka/);
  });

  it("stat needs exactly one row", () => {
    const one = result([{ jumlah: 42 }]);
    expect(buildBlock({ tipe: "stat", judul: "Pasien hari ini", opsi: { satuan: "pasien" } }, one)).toMatchObject({
      y: ["jumlah"],
      baris: [{ jumlah: 42 }],
      satuan: "pasien",
    });
    expect(rejection({ tipe: "stat", judul: "x" }, perPoli)).toMatch(/tepat 1 baris/);
  });

  it("table keeps the chosen columns only; bar refuses too many categories", () => {
    const table = buildBlock({ tipe: "table", judul: "x", opsi: { kolom: ["jumlah", "poli"] } }, perPoli);
    expect(table.kolom).toEqual(["jumlah", "poli"]);
    expect(table.baris[0]).toEqual({ jumlah: 3, poli: "Poli Umum" });
    const many = result(Array.from({ length: 60 }, (_, i) => ({ k: `k${i}`, n: i })));
    expect(rejection({ tipe: "bar", judul: "x" }, many)).toMatch(/Terlalu banyak kategori/);
    expect(buildBlock({ tipe: "line", judul: "x" }, many).baris).toHaveLength(60);
  });

  it("an empty result still renders (as an empty chart or table)", () => {
    expect(buildBlock({ tipe: "bar", judul: "x" }, result([])).baris).toEqual([]);
  });
});

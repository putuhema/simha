import { describe, expect, it } from "vitest";
import { checkFix, FixRejected, inlineParams, selectByKeys } from "./guard.ts";

const PK: Record<string, ReadonlyArray<string>> = {
  kamar_inap: ["no_rawat", "tgl_masuk", "jam_masuk"],
  kamar: ["kd_kamar"],
  reg_periksa: ["no_rawat"],
  rawat_jl_pr: ["no_rawat", "kd_jenis_prw", "nip", "tgl_perawatan", "jam_rawat"],
  pasien: ["no_rkm_medis"],
};
const pk = (table: string) => PK[table] ?? [];
const check = (sql: string, params: ReadonlyArray<string | number | null> = []) => checkFix(sql, params, pk);
const rejection = (sql: string, params: ReadonlyArray<string | number | null> = []) => {
  try {
    check(sql, params);
  } catch (error) {
    if (error instanceof FixRejected) return error.message;
    throw error;
  }
  throw new Error(`expected rejection: ${sql}`);
};

describe("checkFix accepts", () => {
  it("an UPDATE with WHERE, inlining parameters and building the preview", () => {
    const fix = check(
      "UPDATE kamar_inap SET stts_pulang = ?, tgl_keluar = ? WHERE no_rawat = ? AND kd_kamar = ? AND stts_pulang = '-';",
      ["Pindah Kamar", "2026-10-21", "2026/10/21/000002", "MEL-02"],
    );
    expect(fix).toMatchObject({ kind: "update", table: "kamar_inap", setColumns: ["stts_pulang", "tgl_keluar"] });
    expect(fix.sql).toBe(
      "UPDATE kamar_inap SET stts_pulang = 'Pindah Kamar', tgl_keluar = '2026-10-21' WHERE no_rawat = '2026/10/21/000002' AND kd_kamar = 'MEL-02' AND stts_pulang = '-'",
    );
    expect(fix.previewSql).toBe(
      "SELECT * FROM `kamar_inap` WHERE `no_rawat` = '2026/10/21/000002' AND `kd_kamar` = 'MEL-02' AND `stts_pulang` = '-'",
    );
  });

  it("a DELETE on a table that allows it", () => {
    const fix = check("DELETE FROM rawat_jl_pr WHERE no_rawat = '2026/10/01/000003' AND kd_jenis_prw = 'RJ003'");
    expect(fix.kind).toBe("delete");
    expect(fix.previewSql).toContain("FROM `rawat_jl_pr` WHERE");
  });

  it("an INSERT with all primary-key values", () => {
    const fix = check(
      "INSERT INTO kamar_inap (no_rawat, kd_kamar, tgl_masuk, jam_masuk, stts_pulang) VALUES ('2026/10/21/000002', 'MAW-03', '2026-10-22', '09:00:00', '-')",
    );
    expect(fix.insertedKeys).toEqual([{ no_rawat: "2026/10/21/000002", tgl_masuk: "2026-10-22", jam_masuk: "09:00:00" }]);
  });

  it("question marks inside string literals are not parameters", () => {
    expect(inlineParams("UPDATE kamar SET status = ? WHERE kd_kamar = 'A?B'", ["KOSONG"])).toBe(
      "UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar = 'A?B'",
    );
  });
});

describe("checkFix rejects", () => {
  it.each([
    ["SELECT * FROM kamar", /UPDATE, INSERT atau DELETE/],
    ["UPDATE kamar SET status = 'KOSONG'", /tanpa WHERE/],
    ["DELETE FROM kamar_inap", /tanpa WHERE/],
    ["UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar = 'A'; DELETE FROM pasien WHERE 1", /satu statement/],
    ["UPDATE pasien SET nm_pasien = 'X' WHERE no_rkm_medis = '1'", /tidak termasuk daftar/],
    ["DELETE FROM kamar WHERE kd_kamar = 'A'", /DELETE tidak diizinkan pada tabel kamar/],
    ["UPDATE kamar k JOIN bangsal b ON b.kd_bangsal = k.kd_bangsal SET k.status = 'KOSONG' WHERE b.nm_bangsal = 'Mawar'", /satu tabel/],
    ["UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar IN (SELECT kd_kamar FROM kamar_inap)", /satu tabel/],
    ["UPDATE kamar SET kd_kamar = 'B' WHERE kd_kamar = 'A'", /primary key/],
    ["UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar = 'A' LIMIT 1", /LIMIT|tidak bisa dibaca/],
    ["INSERT INTO kamar_inap (no_rawat, kd_kamar) VALUES ('a', 'b')", /primary key: tgl_masuk, jam_masuk/],
    ["INSERT INTO kamar_inap (no_rawat, tgl_masuk, jam_masuk) VALUES ('a', CURDATE(), '09:00:00')", /nilai tetap/],
    ["INSERT INTO kamar_inap SELECT * FROM kamar_inap", /./],
    ["UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar = 'A' -- komentar", /Komentar/],
    ["DROP TABLE kamar", /./],
  ])("%s", (sql, message) => {
    expect(rejection(sql)).toMatch(message);
  });

  it("a parameter count that does not match", () => {
    expect(rejection("UPDATE kamar SET status = ? WHERE kd_kamar = ?", ["KOSONG"])).toMatch(/lebih banyak tanda/);
    expect(rejection("UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar = 'A'", ["x"])).toMatch(/0 tanda/);
  });

  it("parameters cannot inject SQL", () => {
    const fix = check("UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar = ?", ["A' OR '1'='1"]);
    expect(fix.previewSql).toBe("SELECT * FROM `kamar` WHERE `kd_kamar` = 'A\\' OR \\'1\\'=\\'1'");
  });
});

describe("selectByKeys", () => {
  it("selects rows by primary key with NULL-safe equality", () => {
    expect(selectByKeys("kamar", [{ kd_kamar: "A" }, { kd_kamar: "B" }])).toBe(
      "SELECT * FROM `kamar` WHERE (`kd_kamar` <=> 'A') OR (`kd_kamar` <=> 'B')",
    );
  });
});

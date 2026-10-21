/**
 * The 8 read tools against the synthetic test database (fixtures/seed.sql).
 */
import { describe, expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import {
  cariPasien,
  daftarTindakan,
  dataSep,
  kunjunganAktif,
  riwayatKamar,
  statusBilling,
  statusKamar,
  suratKontrol,
} from "../src/read/index.ts";
import { runTool } from "../src/tool.ts";
import { readTestLayer, testDb } from "./helpers.ts";

describe.skipIf(testDb === null)("read tools", () => {
  if (testDb === null) return;

  layer(readTestLayer(testDb), { excludeTestServices: true })((it) => {
    it.effect("cariPasien finds by RM and returns no NIK, phone or address", () =>
      Effect.gen(function* () {
        const result = yield* runTool(cariPasien, { noRkmMedis: "000001" });
        expect(result.pasien).toHaveLength(1);
        expect(result.pasien[0]).toMatchObject({ nm_pasien: "BUDI SANTOSO", png_jawab: "BPJS KESEHATAN" });
        const json = JSON.stringify(result);
        expect(json).not.toContain("5171000000000001");
        expect(json).not.toContain("081300000001");
        expect(json).not.toContain("JL. FIKTIF");
      }),
    );

    it.effect("cariPasien by name matches all words and treats _ and % literally", () =>
      Effect.gen(function* () {
        const budi = yield* runTool(cariPasien, { nama: "budi" });
        expect(budi.pasien.map((p) => p.no_rkm_medis)).toEqual(["000001", "000003"]);
        const exact = yield* runTool(cariPasien, { nama: "budi_h" });
        expect(exact.pasien.map((p) => p.no_rkm_medis)).toEqual(["000003"]);
        const percent = yield* runTool(cariPasien, { nama: "100% sehat" });
        expect(percent.pasien.map((p) => p.no_rkm_medis)).toEqual(["000004"]);
        const twoWords = yield* runTool(cariPasien, { nama: "budi santoso" });
        expect(twoWords.pasien.map((p) => p.no_rkm_medis)).toEqual(["000001"]);
      }),
    );

    it.effect("cariPasien needs RM or name", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(runTool(cariPasien, {}));
        expect(error._tag).toBe("ToolError");
      }),
    );

    it.effect("kunjunganAktif lists visits newest first with the active room", () =>
      Effect.gen(function* () {
        const { kunjungan } = yield* runTool(kunjunganAktif, { noRkmMedis: "000001" });
        expect(kunjungan.map((k) => k.no_rawat)).toEqual([
          "2026/10/20/000001",
          "2026/10/01/000003",
          "2026/09/15/000004",
        ]);
        expect(kunjungan[0]).toMatchObject({
          status_lanjut: "Ranap",
          stts: "Dirawat",
          nm_dokter: "dr. Andi Fiktif",
          kamar_aktif: "MEL-01",
          jumlah_kamar_aktif: 1,
        });
        expect(kunjungan[1]).toMatchObject({ nm_poli: "Poli Gigi", kamar_aktif: null, jumlah_kamar_aktif: 0 });
        const limited = yield* runTool(kunjunganAktif, { noRkmMedis: "000001", batas: 1 });
        expect(limited.kunjungan).toHaveLength(1);
      }),
    );

    it.effect("riwayatKamar shows a stay stuck in two rooms", () =>
      Effect.gen(function* () {
        const result = yield* runTool(riwayatKamar, { noRawat: "2026/10/21/000002" });
        expect(result.jumlahAktif).toBe(2);
        expect(result.kamar.map((k) => [k.kd_kamar, k.nm_bangsal, k.aktif])).toEqual([
          ["MEL-02", "Melati", true],
          ["MAW-01", "Mawar", true],
        ]);
        expect(result.kamar[0]?.tgl_keluar).toBe("0000-00-00");
      }),
    );

    it.effect("riwayatKamar shows a finished room move in order", () =>
      Effect.gen(function* () {
        const result = yield* runTool(riwayatKamar, { noRawat: "2026/09/15/000004" });
        expect(result.jumlahAktif).toBe(0);
        expect(result.kamar.map((k) => [k.kd_kamar, k.stts_pulang, k.tgl_masuk, k.tgl_keluar])).toEqual([
          ["MEL-01", "Pindah Kamar", "2026-09-15", "2026-09-17"],
          ["MAW-03", "Membaik", "2026-09-17", "2026-09-20"],
        ]);
      }),
    );

    it.effect("statusKamar by ward name flags rooms whose status is wrong", () =>
      Effect.gen(function* () {
        const { kamar } = yield* runTool(statusKamar, { namaBangsal: "mawar" });
        const byCode = Object.fromEntries(kamar.map((k) => [k.kd_kamar, k]));
        expect(Object.keys(byCode)).toEqual(["MAW-01", "MAW-02", "MAW-03", "MAW-04"]);
        expect(byCode["MAW-01"]).toMatchObject({ status: "ISI", pasien_aktif: 1, bisaDipakai: false, catatan: null });
        expect(byCode["MAW-02"]).toMatchObject({ status: "ISI", pasien_aktif: 0, bisaDipakai: false });
        expect(byCode["MAW-02"]?.catatan).toMatch(/tidak ada pasien aktif/);
        expect(byCode["MAW-03"]).toMatchObject({ status: "KOSONG", bisaDipakai: true });
        expect(byCode["MAW-04"]).toMatchObject({ status: "DIBERSIHKAN", bisaDipakai: false });
      }),
    );

    it.effect("statusKamar by room code", () =>
      Effect.gen(function* () {
        const { kamar } = yield* runTool(statusKamar, { kdKamar: "MEL-01" });
        expect(kamar).toHaveLength(1);
        expect(kamar[0]).toMatchObject({ nm_bangsal: "Melati", status: "ISI", pasien_aktif: 1 });
      }),
    );

    it.effect("daftarTindakan collects outpatient tindakan from all three tables", () =>
      Effect.gen(function* () {
        const { tindakan } = yield* runTool(daftarTindakan, { noRawat: "2026/10/01/000003" });
        expect(tindakan.map((t) => [t.sumber, t.kd_jenis_prw, t.nm_perawatan, t.stts_bayar])).toEqual([
          ["rawat_jl_pr", "RJ003", "Pasang Infus", "Sudah"],
          ["rawat_jl_dr", "RJ001", "Cabut Gigi", "Sudah"],
          ["rawat_jl_drpr", "RJ002", "Tambal Gigi", "Sudah"],
        ]);
      }),
    );

    it.effect("daftarTindakan collects inpatient tindakan with names from jns_perawatan_inap", () =>
      Effect.gen(function* () {
        const { tindakan } = yield* runTool(daftarTindakan, { noRawat: "2026/10/20/000001" });
        expect(tindakan.map((t) => [t.sumber, t.nm_perawatan, t.tgl_perawatan, t.stts_bayar])).toEqual([
          ["rawat_inap_pr", "Ganti Infus", "2026-10-20", null],
          ["rawat_inap_dr", "Visite Dokter", "2026-10-21", null],
          ["rawat_inap_pr", "Ganti Infus", "2026-10-21", null],
        ]);
      }),
    );

    it.effect("statusBilling: closed outpatient bill, open inpatient stay, unknown visit", () =>
      Effect.gen(function* () {
        const closed = yield* runTool(statusBilling, { noRawat: "2026/10/01/000003" });
        expect(closed).toMatchObject({
          ditemukan: true,
          status_bayar: "Sudah Bayar",
          notaSudahDibuat: true,
          notaJalan: { no_nota: "2026/10/01/RJ0001", tanggal: "2026-10-01", jam: "09:30:00" },
          notaInap: null,
        });
        const open = yield* runTool(statusBilling, { noRawat: "2026/10/20/000001" });
        expect(open).toMatchObject({ ditemukan: true, notaSudahDibuat: false, notaJalan: null, notaInap: null });
        const finishedStay = yield* runTool(statusBilling, { noRawat: "2026/09/15/000004" });
        expect(finishedStay).toMatchObject({ notaSudahDibuat: true, notaInap: { no_nota: "2026/09/20/RI0001" } });
        const missing = yield* runTool(statusBilling, { noRawat: "2099/01/01/999999" });
        expect(missing).toMatchObject({ ditemukan: false, notaSudahDibuat: false });
      }),
    );

    it.effect("dataSep returns bridging data without name, card number or phone", () =>
      Effect.gen(function* () {
        const { sep } = yield* runTool(dataSep, { noRawat: "2026/10/01/000003" });
        expect(sep).toHaveLength(1);
        expect(sep[0]).toMatchObject({
          no_sep: "0001R0011026V000001",
          jnspelayanan: "2",
          nmpolitujuan: "GIGI",
          noskdp: "SKDP/0001",
          tglpulang: "2026-10-01 10:00:00",
        });
        const json = JSON.stringify(sep);
        expect(json).not.toContain("BUDI SANTOSO");
        expect(json).not.toContain("0000000000001");
        expect(json).not.toContain("081300000001");
      }),
    );

    it.effect("suratKontrol lists letters of a SEP", () =>
      Effect.gen(function* () {
        const result = yield* runTool(suratKontrol, { noSep: "0001R0011026V000001" });
        expect(result.suratKontrol).toEqual([
          {
            no_surat: "0001R0011026K000001",
            no_sep: "0001R0011026V000001",
            tgl_surat: "2026-10-01",
            tgl_rencana: "2026-10-15",
            kd_dokter_bpjs: "B001",
            nm_dokter_bpjs: "drg. Sari Fiktif",
            kd_poli_bpjs: "GIG",
            nm_poli_bpjs: "GIGI",
          },
        ]);
      }),
    );

    it.effect("every query is in the audit log, linked to its tool call", () =>
      Effect.gen(function* () {
        yield* runTool(riwayatKamar, { noRawat: "2026/10/20/000001" }, { sessionId: "audit-check" });
        const audit = yield* SqlClient.SqlClient;
        const rows = yield* audit<{ tool: string; pool: string; sql: string; params_json: string; row_count: number }>`
          SELECT tc.tool, q.pool, q.sql, q.params_json, q.row_count
          FROM queries q JOIN tool_calls tc ON tc.id = q.tool_call_id
          WHERE tc.session_id = 'audit-check'`;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ tool: "riwayatKamar", pool: "read", row_count: 1 });
        expect(rows[0]?.sql).toMatch(/FROM kamar_inap/);
        expect(JSON.parse(rows[0]?.params_json ?? "[]")).toEqual(["2026/10/20/000001"]);
      }),
    );
  });
});

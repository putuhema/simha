import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { NoRawat, Str } from "../read/common.ts";
import { defineTool } from "../tool.ts";
import { DiagnosisOutput, summarize, type Finding } from "./findings.ts";

export const diagnosaTindakan = defineTool({
  name: "diagnosaTindakan",
  kind: "diagnose",
  description:
    "Checks a tindakan (procedure) that may have been entered wrongly or needs to be removed: in which of " +
    "the six tindakan tables it exists for this visit, how many times, whether outpatient rows are already " +
    "paid (stts_bayar), and whether the bill (nota_jalan / nota_inap) is already made. Returns one finding " +
    "per check (ok / masalah / info).",
  parameters: Schema.Struct({
    noRawat: NoRawat,
    kdJenisPrw: Str.check(Schema.isNonEmpty(), Schema.isMaxLength(15)).annotate({
      description: "Code of the tindakan (kd_jenis_prw).",
    }),
  }),
  output: DiagnosisOutput,
  handler: Effect.fn("diagnosaTindakan")(function* (params) {
    const read = yield* KhanzaRead;
    const noRawat = params.noRawat.trim();
    const kd = params.kdJenisPrw.trim();
    const temuan: Array<Finding> = [];

    const [visit] = yield* read.query(
      (sql) => sql<{ status_lanjut: string; status_bayar: string; ada_nota_jalan: number; ada_nota_inap: number }>`
        SELECT r.status_lanjut, r.status_bayar,
               (nj.no_rawat IS NOT NULL) AS ada_nota_jalan, (ni.no_rawat IS NOT NULL) AS ada_nota_inap
        FROM reg_periksa r
        LEFT JOIN nota_jalan nj ON nj.no_rawat = r.no_rawat
        LEFT JOIN nota_inap ni ON ni.no_rawat = r.no_rawat
        WHERE r.no_rawat = ${noRawat}`,
    );
    if (visit === undefined) {
      temuan.push({ cek: "Registrasi", hasil: "masalah", keterangan: `no_rawat ${noRawat} tidak ditemukan.` });
      return summarize(temuan);
    }

    const rows = yield* read.query(
      (sql) => sql<{ sumber: string; tgl_perawatan: string; jam_rawat: string; stts_bayar: string | null }>`
        SELECT 'rawat_jl_dr' AS sumber, tgl_perawatan, jam_rawat, stts_bayar FROM rawat_jl_dr WHERE no_rawat = ${noRawat} AND kd_jenis_prw = ${kd}
        UNION ALL SELECT 'rawat_jl_pr', tgl_perawatan, jam_rawat, stts_bayar FROM rawat_jl_pr WHERE no_rawat = ${noRawat} AND kd_jenis_prw = ${kd}
        UNION ALL SELECT 'rawat_jl_drpr', tgl_perawatan, jam_rawat, stts_bayar FROM rawat_jl_drpr WHERE no_rawat = ${noRawat} AND kd_jenis_prw = ${kd}
        UNION ALL SELECT 'rawat_inap_dr', tgl_perawatan, jam_rawat, NULL FROM rawat_inap_dr WHERE no_rawat = ${noRawat} AND kd_jenis_prw = ${kd}
        UNION ALL SELECT 'rawat_inap_pr', tgl_perawatan, jam_rawat, NULL FROM rawat_inap_pr WHERE no_rawat = ${noRawat} AND kd_jenis_prw = ${kd}
        UNION ALL SELECT 'rawat_inap_drpr', tgl_perawatan, jam_rawat, NULL FROM rawat_inap_drpr WHERE no_rawat = ${noRawat} AND kd_jenis_prw = ${kd}
        ORDER BY tgl_perawatan, jam_rawat`,
    );
    if (rows.length === 0) {
      temuan.push({ cek: "Tindakan tercatat", hasil: "masalah", keterangan: `Tindakan ${kd} tidak ada pada no_rawat ${noRawat}.` });
    } else {
      const where = [...new Set(rows.map((r) => r.sumber))].join(", ");
      temuan.push({ cek: "Tindakan tercatat", hasil: "ok", keterangan: `${rows.length} baris di ${where}.` });
      if (rows.length > 1) {
        const times = rows.map((r) => `${r.tgl_perawatan} ${r.jam_rawat}`).join(", ");
        temuan.push({ cek: "Duplikat", hasil: "info", keterangan: `Tindakan yang sama tercatat ${rows.length} kali: ${times}.` });
      }
      const paid = rows.filter((r) => r.stts_bayar === "Sudah").length;
      if (paid > 0) {
        temuan.push({ cek: "Status bayar tindakan", hasil: "masalah", keterangan: `${paid} baris sudah berstatus stts_bayar 'Sudah'.` });
      }
      if (!rows.some((r) => r.sumber === "rawat_jl_pr" || r.sumber === "rawat_inap_pr")) {
        temuan.push({
          cek: "Bisa dihapus lewat perbaikan",
          hasil: "info",
          keterangan: "Baris ada di tabel dokter (_dr/_drpr); perbaikan otomatis hanya boleh menghapus dari rawat_jl_pr / rawat_inap_pr.",
        });
      }
    }

    const notaMade = visit.status_lanjut === "Ranap" ? visit.ada_nota_inap === 1 : visit.ada_nota_jalan === 1;
    temuan.push(
      notaMade
        ? { cek: "Billing", hasil: "masalah", keterangan: `Nota ${visit.status_lanjut === "Ranap" ? "inap" : "jalan"} sudah dibuat; tindakan tidak boleh diubah tanpa membatalkan nota.` }
        : { cek: "Billing", hasil: "ok", keterangan: `Nota belum dibuat (status_bayar '${visit.status_bayar}').` },
    );
    return summarize(temuan);
  }),
});

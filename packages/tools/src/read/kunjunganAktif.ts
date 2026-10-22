import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { ACTIVE_STAY, NoRkmMedis, NullableNum, NullableStr, Str } from "./common.ts";

export const KunjunganRow = Schema.Struct({
  no_rawat: Str,
  no_reg: NullableStr,
  tgl_registrasi: NullableStr,
  jam_reg: NullableStr,
  status_lanjut: Str,
  stts: NullableStr,
  status_bayar: Str,
  kd_poli: NullableStr,
  nm_poli: NullableStr,
  kd_dokter: NullableStr,
  nm_dokter: NullableStr,
  kd_pj: Str,
  png_jawab: NullableStr,
  kamar_aktif: NullableStr,
  jumlah_kamar_aktif: NullableNum,
});

export const kunjunganAktif = defineTool({
  name: "kunjunganAktif",
  kind: "read",
  description:
    "Latest visits (reg_periksa) of a patient, newest first: visit number, date, Ralan/Ranap, status (stts), " +
    "payment status, clinic, doctor, payer, and for inpatients the current room (kamar_aktif) and how many " +
    "kamar_inap rows are still active (should be 0 or 1).",
  parameters: Schema.Struct({
    noRkmMedis: NoRkmMedis,
    batas: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })).annotate({
        description: "How many visits to return (1-50, default 10).",
      }),
    ),
  }),
  output: Schema.Struct({ kunjungan: Schema.Array(KunjunganRow) }),
  handler: Effect.fn("kunjunganAktif")(function* (params) {
    const read = yield* KhanzaRead;
    const limit = params.batas ?? 10;
    const rows = yield* read.query(
      (sql) => sql`
        SELECT r.no_rawat, r.no_reg, r.tgl_registrasi, r.jam_reg, r.status_lanjut, r.stts, r.status_bayar,
               r.kd_poli, pl.nm_poli, r.kd_dokter, d.nm_dokter, r.kd_pj, pj.png_jawab,
               (SELECT ki.kd_kamar FROM kamar_inap ki
                 WHERE ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}
                 ORDER BY ki.tgl_masuk DESC, ki.jam_masuk DESC LIMIT 1) AS kamar_aktif,
               (SELECT COUNT(*) FROM kamar_inap ki
                 WHERE ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}) AS jumlah_kamar_aktif
        FROM reg_periksa r
        LEFT JOIN poliklinik pl ON pl.kd_poli = r.kd_poli
        LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
        LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
        WHERE r.no_rkm_medis = ${params.noRkmMedis.trim()}
        ORDER BY r.tgl_registrasi DESC, r.jam_reg DESC
        LIMIT ${sql.literal(String(limit))}`,
    );
    return { kunjungan: yield* decodeRows("kunjunganAktif", KunjunganRow)(rows) };
  }),
});

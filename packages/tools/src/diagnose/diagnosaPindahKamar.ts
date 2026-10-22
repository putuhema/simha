import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { ACTIVE_STAY, NoRawat, Str } from "../read/common.ts";
import { defineTool } from "../tool.ts";
import { DiagnosisOutput, summarize, type Finding } from "./findings.ts";

export const diagnosaPindahKamar = defineTool({
  name: "diagnosaPindahKamar",
  kind: "diagnose",
  description:
    "Checks why an inpatient cannot be moved to another room. Runs these checks and returns one finding " +
    "per check (ok / masalah / info): the visit exists and is an inpatient stay (Ranap) that is still open, " +
    "the inpatient bill (nota_inap) is not made yet, the stay has exactly one active kamar_inap row, the " +
    "target room exists, is in use (statusdata '1'), is KOSONG and has no active patient, and the target is " +
    "not the current room.",
  parameters: Schema.Struct({
    noRawat: NoRawat,
    kdKamarTujuan: Str.check(Schema.isNonEmpty(), Schema.isMaxLength(15)).annotate({
      description: "Code of the room the nurse wants to move the patient to (kd_kamar).",
    }),
  }),
  output: DiagnosisOutput,
  handler: Effect.fn("diagnosaPindahKamar")(function* (params) {
    const read = yield* KhanzaRead;
    const noRawat = params.noRawat.trim();
    const target = params.kdKamarTujuan.trim();
    const temuan: Array<Finding> = [];

    const [visit] = yield* read.query(
      (sql) => sql<{ status_lanjut: string; stts: string | null; status_bayar: string; ada_nota_inap: number }>`
        SELECT r.status_lanjut, r.stts, r.status_bayar, (ni.no_rawat IS NOT NULL) AS ada_nota_inap
        FROM reg_periksa r LEFT JOIN nota_inap ni ON ni.no_rawat = r.no_rawat
        WHERE r.no_rawat = ${noRawat}`,
    );
    if (visit === undefined) {
      temuan.push({ cek: "Registrasi", hasil: "masalah", keterangan: `no_rawat ${noRawat} tidak ditemukan.` });
      return summarize(temuan);
    }
    temuan.push(
      visit.status_lanjut === "Ranap"
        ? { cek: "Jenis rawat", hasil: "ok", keterangan: "Kunjungan rawat inap (Ranap)." }
        : { cek: "Jenis rawat", hasil: "masalah", keterangan: `Kunjungan ini ${visit.status_lanjut}, bukan Ranap.` },
    );
    temuan.push(
      visit.stts === "Sudah" || visit.stts === "Batal" || visit.stts === "Meninggal"
        ? { cek: "Status registrasi", hasil: "masalah", keterangan: `reg_periksa.stts = '${visit.stts}', registrasi sudah selesai.` }
        : { cek: "Status registrasi", hasil: "ok", keterangan: `reg_periksa.stts = '${visit.stts ?? "-"}'.` },
    );
    temuan.push(
      visit.ada_nota_inap === 1
        ? { cek: "Billing", hasil: "masalah", keterangan: "Nota rawat inap sudah dibuat; Khanza biasanya menolak pindah kamar." }
        : { cek: "Billing", hasil: "ok", keterangan: `Nota inap belum dibuat (status_bayar '${visit.status_bayar}').` },
    );

    const active = yield* read.query(
      (sql) => sql<{ kd_kamar: string; tgl_masuk: string; jam_masuk: string }>`
        SELECT kd_kamar, tgl_masuk, jam_masuk FROM kamar_inap
        WHERE no_rawat = ${noRawat} AND stts_pulang = ${ACTIVE_STAY}
        ORDER BY tgl_masuk, jam_masuk`,
    );
    const list = active.map((a) => `${a.kd_kamar} (masuk ${a.tgl_masuk} ${a.jam_masuk})`).join(", ");
    temuan.push(
      active.length === 1
        ? { cek: "Kamar aktif", hasil: "ok", keterangan: `Satu kamar aktif: ${list}.` }
        : active.length === 0
          ? { cek: "Kamar aktif", hasil: "masalah", keterangan: "Tidak ada baris kamar_inap aktif (stts_pulang '-')." }
          : { cek: "Kamar aktif", hasil: "masalah", keterangan: `${active.length} baris kamar_inap aktif sekaligus: ${list}.` },
    );
    if (active.some((a) => a.kd_kamar === target)) {
      temuan.push({ cek: "Kamar tujuan", hasil: "masalah", keterangan: `Pasien sudah tercatat aktif di ${target}.` });
    }

    const [room] = yield* read.query(
      (sql) => sql<{ status: string | null; statusdata: string | null; nm_bangsal: string | null; pasien_aktif: number }>`
        SELECT k.status, k.statusdata, b.nm_bangsal,
               (SELECT COUNT(*) FROM kamar_inap ki WHERE ki.kd_kamar = k.kd_kamar AND ki.stts_pulang = ${ACTIVE_STAY}) AS pasien_aktif
        FROM kamar k LEFT JOIN bangsal b ON b.kd_bangsal = k.kd_bangsal
        WHERE k.kd_kamar = ${target}`,
    );
    if (room === undefined) {
      temuan.push({ cek: "Kamar tujuan", hasil: "masalah", keterangan: `Kamar ${target} tidak ada di tabel kamar.` });
      return summarize(temuan);
    }
    const where = `${target} (${room.nm_bangsal ?? "?"})`;
    if (room.statusdata !== "1") {
      temuan.push({ cek: "Kamar tujuan aktif", hasil: "masalah", keterangan: `${where} statusdata = '${room.statusdata ?? "-"}' (tidak dipakai).` });
    }
    temuan.push(
      room.status === "KOSONG" && room.pasien_aktif === 0
        ? { cek: "Kamar tujuan kosong", hasil: "ok", keterangan: `${where} KOSONG dan tanpa pasien aktif.` }
        : room.status === "ISI" && room.pasien_aktif === 0
          ? { cek: "Kamar tujuan kosong", hasil: "masalah", keterangan: `${where} berstatus ISI tetapi tidak ada pasien aktif (status kamar tidak sinkron).` }
          : { cek: "Kamar tujuan kosong", hasil: "masalah", keterangan: `${where} status ${room.status ?? "-"}, ${room.pasien_aktif} pasien aktif.` },
    );
    return summarize(temuan);
  }),
});

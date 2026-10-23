/**
 * Why can an inpatient not be discharged? Runs the checks a nurse's "tidak
 * bisa pulang" complaint needs, in one place: registration status, open room
 * rows, billing, resume, BPJS SEP and DPJP. Findings only; the AI explains.
 */
import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { ACTIVE_STAY, NoRawat } from "../read/common.ts";
import { defineTool } from "../tool.ts";
import { DiagnosisOutput, summarize, type Finding } from "./findings.ts";

/** reg_periksa.stts values that mean the registration is already finished. */
const CLOSED_STATUSES = new Set(["Sudah", "Batal", "Meninggal", "Dirujuk", "Pulang Paksa"]);

export const diagnosaPulang = defineTool({
  name: "diagnosaPulang",
  kind: "diagnose",
  description:
    "Checks why an inpatient cannot be discharged (pulang). Runs these checks and returns one finding per " +
    "check (ok / masalah / info): the visit exists and is an inpatient stay (Ranap), reg_periksa.stts is " +
    "still open while a kamar_inap row is active (a completed registration with an open room), there is " +
    "exactly one active kamar_inap row, no half-closed room rows, the inpatient bill (nota_inap) is not " +
    "made yet, whether the resume medis and DPJP exist, and whether the BPJS SEP is still open. Use it " +
    "before proposing a discharge fix.",
  parameters: Schema.Struct({ noRawat: NoRawat }),
  output: DiagnosisOutput,
  handler: Effect.fn("diagnosaPulang")(function* (params) {
    const read = yield* KhanzaRead;
    const noRawat = params.noRawat.trim();
    const temuan: Array<Finding> = [];

    const [visit] = yield* read.query(
      (sql) => sql<{
        status_lanjut: string;
        stts: string | null;
        status_bayar: string;
        ada_nota_inap: number;
        ada_resume: number;
        ada_dpjp: number;
        jumlah_sep: number;
        sep_tertutup: number;
      }>`
        SELECT r.status_lanjut, r.stts, r.status_bayar,
               (ni.no_rawat IS NOT NULL) AS ada_nota_inap,
               EXISTS (SELECT 1 FROM resume_pasien_ranap rp WHERE rp.no_rawat = r.no_rawat) AS ada_resume,
               EXISTS (SELECT 1 FROM dpjp_ranap d WHERE d.no_rawat = r.no_rawat) AS ada_dpjp,
               (SELECT COUNT(*) FROM bridging_sep s WHERE s.no_rawat = r.no_rawat) AS jumlah_sep,
               (SELECT COUNT(*) FROM bridging_sep s WHERE s.no_rawat = r.no_rawat
                  AND s.tglpulang <> '0000-00-00 00:00:00') AS sep_tertutup
        FROM reg_periksa r
        LEFT JOIN nota_inap ni ON ni.no_rawat = r.no_rawat
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

    const rooms = yield* read.query(
      (sql) => sql<{ kd_kamar: string; tgl_masuk: string; jam_masuk: string; tgl_keluar: string | null; jam_keluar: string | null; stts_pulang: string }>`
        SELECT kd_kamar, tgl_masuk, jam_masuk, tgl_keluar, jam_keluar, stts_pulang
        FROM kamar_inap WHERE no_rawat = ${noRawat} ORDER BY tgl_masuk, jam_masuk`,
    );
    const active = rooms.filter((r) => r.stts_pulang === ACTIVE_STAY);
    const halfClosed = rooms.filter(
      (r) =>
        r.stts_pulang !== ACTIVE_STAY &&
        (r.tgl_keluar === null || r.tgl_keluar === "0000-00-00" || r.jam_keluar === null || r.jam_keluar === "00:00:00"),
    );
    const activeList = active.map((r) => `${r.kd_kamar} (masuk ${r.tgl_masuk} ${r.jam_masuk})`).join(", ");

    const stts = visit.stts ?? "-";
    if (CLOSED_STATUSES.has(stts)) {
      temuan.push(
        active.length > 0
          ? {
              cek: "Status registrasi",
              hasil: "masalah",
              keterangan: `reg_periksa.stts = '${stts}', tetapi kamar ${activeList} masih aktif. Registrasi sudah dianggap selesai padahal pasien masih di kamar; pasien bisa tidak muncul di daftar Rawat Inap atau tombol Pulang ditolak. Periksa apakah stts seharusnya 'Dirawat'.`,
            }
          : {
              cek: "Status registrasi",
              hasil: "info",
              keterangan: `reg_periksa.stts = '${stts}' dan tidak ada kamar aktif; pasien sudah pulang.`,
            },
      );
    } else {
      temuan.push({
        cek: "Status registrasi",
        hasil: "ok",
        keterangan: `reg_periksa.stts = '${stts}', masih dalam perawatan.`,
      });
    }

    if (active.length === 0) {
      temuan.push({
        cek: "Kamar aktif",
        hasil: CLOSED_STATUSES.has(stts) ? "info" : "masalah",
        keterangan: CLOSED_STATUSES.has(stts)
          ? "Tidak ada baris kamar_inap aktif; pasien sudah pulang."
          : "Tidak ada baris kamar_inap aktif (stts_pulang '-'); tidak ada kamar yang bisa dipulangkan.",
      });
    } else if (active.length > 1) {
      temuan.push({
        cek: "Kamar aktif",
        hasil: "masalah",
        keterangan: `${active.length} kamar aktif sekaligus: ${activeList}. Tutup kamar yang lama dulu (biasanya 'Pindah Kamar').`,
      });
    } else {
      temuan.push({ cek: "Kamar aktif", hasil: "ok", keterangan: `Satu kamar aktif: ${activeList}.` });
    }

    if (halfClosed.length > 0) {
      temuan.push({
        cek: "Riwayat kamar",
        hasil: "info",
        keterangan: `${halfClosed.length} baris sudah punya stts_pulang '${halfClosed[0]?.stts_pulang ?? "?"}' tetapi tgl/jam keluar masih kosong.`,
      });
    }

    if (active.length === 0) {
      temuan.push({
        cek: "Billing",
        hasil: "info",
        keterangan: `Tidak ada kamar aktif; nota inap ${visit.ada_nota_inap === 1 ? "sudah" : "belum"} dibuat (status_bayar '${visit.status_bayar}').`,
      });
    } else {
      temuan.push(
        visit.ada_nota_inap === 1
          ? {
              cek: "Billing",
              hasil: "masalah",
              keterangan: "Nota rawat inap sudah dibuat; data kunjungan/kamar tidak bisa diubah tanpa membatalkan nota.",
            }
          : { cek: "Billing", hasil: "ok", keterangan: `Nota inap belum dibuat (status_bayar '${visit.status_bayar}').` },
      );
    }

    temuan.push(
      visit.ada_resume === 1
        ? { cek: "Resume medis", hasil: "ok", keterangan: "Resume medis ranap sudah ada." }
        : { cek: "Resume medis", hasil: "info", keterangan: "Resume medis ranap belum diisi; lengkapi sebelum atau saat pulang." },
    );

    temuan.push(
      visit.ada_dpjp === 1
        ? { cek: "DPJP", hasil: "ok", keterangan: "DPJP rawat inap sudah tercatat." }
        : { cek: "DPJP", hasil: "info", keterangan: "Belum ada DPJP rawat inap (dpjp_ranap)." },
    );

    if (visit.jumlah_sep === 0) {
      temuan.push({ cek: "SEP BPJS", hasil: "info", keterangan: "Tidak ada SEP BPJS untuk kunjungan ini." });
    } else if (visit.sep_tertutup === 0) {
      temuan.push({
        cek: "SEP BPJS",
        hasil: "info",
        keterangan: `SEP ada (${visit.jumlah_sep}) dan masih terbuka (tglpulang 0000-00-00). Tutup SEP setelah pasien pulang; ini tidak menghalangi tombol Pulang di Khanza.`,
      });
    } else {
      temuan.push({ cek: "SEP BPJS", hasil: "ok", keterangan: `SEP sudah ditutup (${visit.sep_tertutup}/${visit.jumlah_sep}).` });
    }

    return summarize(temuan);
  }),
});

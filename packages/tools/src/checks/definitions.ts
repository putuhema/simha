/**
 * The routine checks. Each one is a read-only question about a data pattern
 * that makes Khanza misbehave, written as two queries: how many hits, and at
 * most 20 sample rows for the page.
 *
 * Definitions are data, not code paths: adding a check is one entry in
 * `ROUTINE_CHECKS`. Every query goes through KhanzaRead, so it uses the
 * SELECT-only user, the server-side time limit and the audit log.
 *
 * The patterns come from the diagnosis tools and the local notes:
 * - a patient with two active kamar_inap rows cannot be moved;
 * - a registration already 'Sudah' with a room still open cannot be discharged;
 * - a room marked ISI with nobody in it (or KOSONG with somebody) misleads
 *   the room list and the move dialog;
 * - an active stay without DPJP or diagnosis is incomplete for billing/BPJS;
 * - a SEP still open after the visit closed blocks the next claim.
 */
import type { CheckHit, CheckSeverity } from "@simha/shared";
import { Effect } from "effect";
import type { KhanzaQueryError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { ACTIVE_STAY } from "../read/common.ts";

/** Most sample rows stored per check; `count` still holds the real total. */
export const CHECK_SAMPLE_LIMIT = 20;

export interface CheckRunData {
  readonly total: number;
  readonly sample: ReadonlyArray<CheckHit>;
}

export interface CheckDefinition {
  /** Stable id, used in the audit DB and the UI. Never renamed. */
  readonly id: string;
  readonly title: string;
  readonly severity: CheckSeverity;
  /** What the check looks for. */
  readonly description: string;
  /** What staff should do when it finds something. */
  readonly advice: string;
  readonly run: Effect.Effect<CheckRunData, KhanzaQueryError, KhanzaRead>;
}

/** reg_periksa.stts values that mean the visit is over. */
const CLOSED_STATUSES = ["Sudah", "Batal", "Meninggal", "Dirujuk", "Pulang Paksa"];

const hits = (
  rows: ReadonlyArray<{ readonly noRawat?: string | null; readonly noRm?: string | null; readonly pasien?: string | null; readonly keterangan: string }>,
): ReadonlyArray<CheckHit> =>
  rows.map((row) => ({
    noRawat: row.noRawat ?? null,
    noRm: row.noRm ?? null,
    pasien: row.pasien ?? null,
    keterangan: row.keterangan,
  }));

/** Two active room rows for one visit: Khanza's move/discharge then edits the wrong row. */
const kamarGanda: CheckDefinition = {
  id: "kamar-ganda",
  title: "Dua kamar aktif untuk satu kunjungan",
  severity: "kritis",
  description:
    "Satu no_rawat punya lebih dari satu baris kamar_inap dengan stts_pulang '-'. Khanza menganggap pasien ada di beberapa kamar sekaligus.",
  advice:
    "Tutup kamar yang lama (isi tgl_keluar, jam_keluar dan stts_pulang yang benar), sisakan satu kamar aktif. Ini penyebab paling sering dari “tidak bisa pindah kamar”.",
  run: Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [count] = yield* read.query(
      (sql) => sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM (
          SELECT ki.no_rawat FROM kamar_inap ki
          WHERE ki.stts_pulang = ${ACTIVE_STAY}
          GROUP BY ki.no_rawat HAVING COUNT(*) > 1
        ) AS x`,
    );
    const rows = yield* read.query(
      (sql) => sql<{ noRawat: string; noRm: string | null; pasien: string | null; jumlah: number; kamar: string | null }>`
        SELECT ki.no_rawat AS noRawat, r.no_rkm_medis AS noRm, p.nm_pasien AS pasien,
               COUNT(*) AS jumlah,
               GROUP_CONCAT(CONCAT(ki.kd_kamar, ' sejak ', DATE_FORMAT(ki.tgl_masuk, '%d-%m-%Y'))
                 ORDER BY ki.tgl_masuk, ki.jam_masuk SEPARATOR ', ') AS kamar
        FROM kamar_inap ki
        JOIN reg_periksa r ON r.no_rawat = ki.no_rawat
        LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
        WHERE ki.stts_pulang = ${ACTIVE_STAY}
        GROUP BY ki.no_rawat, r.no_rkm_medis, p.nm_pasien
        HAVING COUNT(*) > 1
        ORDER BY ki.no_rawat
        LIMIT ${CHECK_SAMPLE_LIMIT}`,
    );
    return {
      total: Number(count?.n ?? 0),
      sample: hits(
        rows.map((row) => ({
          noRawat: row.noRawat,
          noRm: row.noRm,
          pasien: row.pasien,
          keterangan: `${Number(row.jumlah)} kamar aktif: ${row.kamar ?? "-"}`,
        })),
      ),
    };
  }),
};

/** reg_periksa already finished, but the room row is still open: "tidak bisa pulang". */
const pulangKamarAktif: CheckDefinition = {
  id: "pulang-kamar-aktif",
  title: "Registrasi sudah selesai, kamar masih aktif",
  severity: "kritis",
  description:
    "reg_periksa.stts sudah Sudah/Batal/Meninggal/Dirujuk, tetapi masih ada kamar_inap dengan stts_pulang '-'. Pasien bisa hilang dari daftar Rawat Inap dan tombol Pulang ditolak.",
  advice:
    "Ubah status registrasi kembali ke 'Dirawat' bila pasien masih dirawat, atau tutup kamar dengan tanggal/jam keluar yang benar bila pasien sudah pulang.",
  run: Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [count] = yield* read.query(
      (sql) => sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM (
          SELECT r.no_rawat FROM reg_periksa r
          JOIN kamar_inap ki ON ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}
          WHERE r.stts IN ${sql.in(CLOSED_STATUSES)}
          GROUP BY r.no_rawat
        ) AS x`,
    );
    const rows = yield* read.query(
      (sql) => sql<{ noRawat: string; noRm: string | null; pasien: string | null; stts: string; kamar: string | null }>`
        SELECT r.no_rawat AS noRawat, r.no_rkm_medis AS noRm, p.nm_pasien AS pasien, r.stts,
               GROUP_CONCAT(ki.kd_kamar ORDER BY ki.tgl_masuk SEPARATOR ', ') AS kamar
        FROM reg_periksa r
        JOIN kamar_inap ki ON ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}
        LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
        WHERE r.stts IN ${sql.in(CLOSED_STATUSES)}
        GROUP BY r.no_rawat, r.no_rkm_medis, p.nm_pasien, r.stts
        ORDER BY r.no_rawat
        LIMIT ${CHECK_SAMPLE_LIMIT}`,
    );
    return {
      total: Number(count?.n ?? 0),
      sample: hits(
        rows.map((row) => ({
          noRawat: row.noRawat,
          noRm: row.noRm,
          pasien: row.pasien,
          keterangan: `stts '${row.stts}' tetapi kamar ${row.kamar ?? "-"} masih aktif`,
        })),
      ),
    };
  }),
};

/** Room master status and its actual occupants disagree. */
const kamarStatusSalah: CheckDefinition = {
  id: "kamar-status-salah",
  title: "Status kamar tidak sesuai penghuni",
  severity: "peringatan",
  description:
    "kamar.status berkata ISI tetapi tidak ada pasien aktif, atau KOSONG padahal ada pasien aktif. Daftar kamar dan dialog pindah kamar jadi menyesatkan.",
  advice:
    "Perbaiki status kamar lewat menu Kamar (atau hitung ulang dari kamar_inap): ISI bila ada pasien, KOSONG bila tidak ada.",
  run: Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [count] = yield* read.query(
      (sql) => sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM kamar k
        WHERE k.statusdata = '1'
          AND (
            (k.status = 'ISI' AND NOT EXISTS (
              SELECT 1 FROM kamar_inap ki WHERE ki.kd_kamar = k.kd_kamar AND ki.stts_pulang = ${ACTIVE_STAY}))
            OR
            (k.status = 'KOSONG' AND EXISTS (
              SELECT 1 FROM kamar_inap ki WHERE ki.kd_kamar = k.kd_kamar AND ki.stts_pulang = ${ACTIVE_STAY}))
          )`,
    );
    const rows = yield* read.query(
      (sql) => sql<{ kamar: string; bangsal: string | null; status: string; penghuni: number }>`
        SELECT k.kd_kamar AS kamar, b.nm_bangsal AS bangsal, k.status,
               (SELECT COUNT(*) FROM kamar_inap ki
                 WHERE ki.kd_kamar = k.kd_kamar AND ki.stts_pulang = ${ACTIVE_STAY}) AS penghuni
        FROM kamar k
        LEFT JOIN bangsal b ON b.kd_bangsal = k.kd_bangsal
        WHERE k.statusdata = '1'
          AND (
            (k.status = 'ISI' AND NOT EXISTS (
              SELECT 1 FROM kamar_inap ki WHERE ki.kd_kamar = k.kd_kamar AND ki.stts_pulang = ${ACTIVE_STAY}))
            OR
            (k.status = 'KOSONG' AND EXISTS (
              SELECT 1 FROM kamar_inap ki WHERE ki.kd_kamar = k.kd_kamar AND ki.stts_pulang = ${ACTIVE_STAY}))
          )
        ORDER BY k.kd_kamar
        LIMIT ${CHECK_SAMPLE_LIMIT}`,
    );
    return {
      total: Number(count?.n ?? 0),
      sample: hits(
        rows.map((row) => ({
          noRawat: null,
          noRm: null,
          pasien: null,
          keterangan: `Kamar ${row.kamar} (${row.bangsal ?? "?"}) berstatus ${row.status}, ${Number(row.penghuni)} pasien aktif`,
        })),
      ),
    };
  }),
};

/** An active stay without a DPJP row (billing and BPJS need it). */
const ranapTanpaDpjp: CheckDefinition = {
  id: "ranap-tanpa-dpjp",
  title: "Rawat inap aktif tanpa DPJP",
  severity: "info",
  description:
    "Ada kamar_inap aktif tetapi tidak ada baris dpjp_ranap untuk kunjungan itu. Beberapa laporan dan klaim membutuhkan DPJP.",
  advice: "Isi DPJP rawat inap lewat menu Rawat Inap, atau pastikan dokter penanggung jawab sudah dipilih saat pasien masuk.",
  run: Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [count] = yield* read.query(
      (sql) => sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM (
          SELECT r.no_rawat FROM reg_periksa r
          JOIN kamar_inap ki ON ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}
          WHERE NOT EXISTS (SELECT 1 FROM dpjp_ranap d WHERE d.no_rawat = r.no_rawat)
          GROUP BY r.no_rawat
        ) AS x`,
    );
    const rows = yield* read.query(
      (sql) => sql<{ noRawat: string; noRm: string | null; pasien: string | null; kamar: string | null }>`
        SELECT r.no_rawat AS noRawat, r.no_rkm_medis AS noRm, p.nm_pasien AS pasien,
               GROUP_CONCAT(ki.kd_kamar ORDER BY ki.tgl_masuk SEPARATOR ', ') AS kamar
        FROM reg_periksa r
        JOIN kamar_inap ki ON ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}
        LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
        WHERE NOT EXISTS (SELECT 1 FROM dpjp_ranap d WHERE d.no_rawat = r.no_rawat)
        GROUP BY r.no_rawat, r.no_rkm_medis, p.nm_pasien
        ORDER BY r.no_rawat
        LIMIT ${CHECK_SAMPLE_LIMIT}`,
    );
    return {
      total: Number(count?.n ?? 0),
      sample: hits(
        rows.map((row) => ({
          noRawat: row.noRawat,
          noRm: row.noRm,
          pasien: row.pasien,
          keterangan: `Rawat inap di ${row.kamar ?? "-"} tanpa DPJP (dpjp_ranap)`,
        })),
      ),
    };
  }),
};

/** An active stay without a single Ranap diagnosis. */
const ranapTanpaDiagnosa: CheckDefinition = {
  id: "ranap-tanpa-diagnosa",
  title: "Rawat inap aktif tanpa diagnosis",
  severity: "peringatan",
  description:
    "Kunjungan rawat inap dengan kamar aktif belum punya diagnosa_pasien berstatus Ranap. Resume, laporan dan klaim BPJS akan kosong.",
  advice: "Isi diagnosis di CPPT/diagnosa pasien (status Ranap) sebelum pasien pulang.",
  run: Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [count] = yield* read.query(
      (sql) => sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM (
          SELECT r.no_rawat FROM reg_periksa r
          JOIN kamar_inap ki ON ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}
          WHERE NOT EXISTS (
            SELECT 1 FROM diagnosa_pasien d WHERE d.no_rawat = r.no_rawat AND d.status = 'Ranap')
          GROUP BY r.no_rawat
        ) AS x`,
    );
    const rows = yield* read.query(
      (sql) => sql<{ noRawat: string; noRm: string | null; pasien: string | null; kamar: string | null }>`
        SELECT r.no_rawat AS noRawat, r.no_rkm_medis AS noRm, p.nm_pasien AS pasien,
               GROUP_CONCAT(ki.kd_kamar ORDER BY ki.tgl_masuk SEPARATOR ', ') AS kamar
        FROM reg_periksa r
        JOIN kamar_inap ki ON ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY}
        LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
        WHERE NOT EXISTS (
          SELECT 1 FROM diagnosa_pasien d WHERE d.no_rawat = r.no_rawat AND d.status = 'Ranap')
        GROUP BY r.no_rawat, r.no_rkm_medis, p.nm_pasien
        ORDER BY r.no_rawat
        LIMIT ${CHECK_SAMPLE_LIMIT}`,
    );
    return {
      total: Number(count?.n ?? 0),
      sample: hits(
        rows.map((row) => ({
          noRawat: row.noRawat,
          noRm: row.noRm,
          pasien: row.pasien,
          keterangan: `Belum ada diagnosis Ranap untuk kunjungan di ${row.kamar ?? "-"}`,
        })),
      ),
    };
  }),
};

/** A SEP still open after its visit closed. */
const sepBelumDitutup: CheckDefinition = {
  id: "sep-belum-ditutup",
  title: "SEP BPJS masih terbuka untuk kunjungan selesai",
  severity: "peringatan",
  description:
    "bridging_sep.tglpulang masih kosong/'0000-00-00' padahal reg_periksa.stts sudah selesai. SEP yang menggantung menyulitkan klaim berikutnya.",
  advice: "Tutup SEP di menu BPJS (isi tanggal pulang) atau periksa apakah status kunjungan yang seharusnya masih terbuka.",
  run: Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [count] = yield* read.query(
      (sql) => sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM bridging_sep s
        JOIN reg_periksa r ON r.no_rawat = s.no_rawat
        WHERE (s.tglpulang IS NULL OR s.tglpulang = '0000-00-00 00:00:00')
          AND r.stts IN ${sql.in(CLOSED_STATUSES)}`,
    );
    const rows = yield* read.query(
      (sql) => sql<{ noSep: string; noRawat: string; noRm: string | null; pasien: string | null; stts: string }>`
        SELECT s.no_sep AS noSep, s.no_rawat AS noRawat, r.no_rkm_medis AS noRm,
               p.nm_pasien AS pasien, r.stts
        FROM bridging_sep s
        JOIN reg_periksa r ON r.no_rawat = s.no_rawat
        LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
        WHERE (s.tglpulang IS NULL OR s.tglpulang = '0000-00-00 00:00:00')
          AND r.stts IN ${sql.in(CLOSED_STATUSES)}
        ORDER BY s.no_sep
        LIMIT ${CHECK_SAMPLE_LIMIT}`,
    );
    return {
      total: Number(count?.n ?? 0),
      sample: hits(
        rows.map((row) => ({
          noRawat: row.noRawat,
          noRm: row.noRm,
          pasien: row.pasien,
          keterangan: `SEP ${row.noSep} belum ditutup padahal registrasi '${row.stts}'`,
        })),
      ),
    };
  }),
};

/** An open Ranap registration with no active room. */
const ranapTanpaKamar: CheckDefinition = {
  id: "ranap-tanpa-kamar",
  title: "Rawat inap aktif tanpa kamar",
  severity: "kritis",
  description:
    "reg_periksa berstatus Ranap dan belum selesai, tetapi tidak ada kamar_inap aktif (stts_pulang '-'). Pasien tidak muncul di daftar rawat inap.",
  advice: "Daftarkan pasien ke kamar (menu Rawat Inap) atau perbaiki status registrasi bila pasien sebenarnya sudah pulang/batal.",
  run: Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [count] = yield* read.query(
      (sql) => sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM reg_periksa r
        WHERE r.status_lanjut = 'Ranap'
          AND r.stts NOT IN ${sql.in(CLOSED_STATUSES)}
          AND NOT EXISTS (
            SELECT 1 FROM kamar_inap ki WHERE ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY})`,
    );
    const rows = yield* read.query(
      (sql) => sql<{ noRawat: string; noRm: string | null; pasien: string | null; stts: string }>`
        SELECT r.no_rawat AS noRawat, r.no_rkm_medis AS noRm, p.nm_pasien AS pasien, r.stts
        FROM reg_periksa r
        LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
        WHERE r.status_lanjut = 'Ranap'
          AND r.stts NOT IN ${sql.in(CLOSED_STATUSES)}
          AND NOT EXISTS (
            SELECT 1 FROM kamar_inap ki WHERE ki.no_rawat = r.no_rawat AND ki.stts_pulang = ${ACTIVE_STAY})
        ORDER BY r.no_rawat
        LIMIT ${CHECK_SAMPLE_LIMIT}`,
    );
    return {
      total: Number(count?.n ?? 0),
      sample: hits(
        rows.map((row) => ({
          noRawat: row.noRawat,
          noRm: row.noRm,
          pasien: row.pasien,
          keterangan: `Registrasi Ranap masih '${row.stts}' tetapi tidak ada kamar aktif`,
        })),
      ),
    };
  }),
};

/** Every routine check, in the order the page shows them. */
export const ROUTINE_CHECKS: ReadonlyArray<CheckDefinition> = [
  kamarGanda,
  pulangKamarAktif,
  ranapTanpaKamar,
  kamarStatusSalah,
  ranapTanpaDiagnosa,
  sepBelumDitutup,
  ranapTanpaDpjp,
];

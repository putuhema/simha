/**
 * Khanza data for patient documents, with fixed parameterized queries on the
 * read user. Field names of free clinical text (subjektif, objektif, asesmen,
 * ...) are masked for external AI providers by privacy/mask.ts.
 *
 * Sources (checked against our schema, Oct 2026):
 * - CPPT / SOAP: pemeriksaan_ralan and pemeriksaan_ranap
 *   (S = keluhan, O = pemeriksaan + vital signs, A = penilaian, P = rtl,
 *   plus instruksi and evaluasi); the writer is `nip`, a doctor or a petugas.
 * - diagnoses: diagnosa_pasien + penyakit (ICD-10)
 * - lab: detail_periksa_lab + template_laboratorium + jns_perawatan_lab
 * - radiology: hasil_radiologi
 * - resume: resume_pasien (outpatient) / resume_pasien_ranap (inpatient)
 */
import { Effect } from "effect";
import { ToolError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { cariPasien } from "../read/cariPasien.ts";

/** Most visits in a history document; older ones are left out (and said so). */
const MAX_HISTORY_VISITS = 20;
const MAX_CPPT_ROWS = 300;

type Row = Record<string, unknown>;

const str = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

export interface Identity {
  readonly noRkmMedis: string;
  readonly nama: string | null;
  readonly jk: string | null;
  readonly tglLahir: string | null;
  readonly umur: string | null;
  readonly penjamin: string | null;
}

export interface Diagnosis {
  readonly kode: string;
  readonly nama: string | null;
  readonly prioritas: number;
}

export interface Visit {
  readonly noRawat: string;
  readonly tanggal: string | null;
  readonly jam: string | null;
  readonly jenis: "Rawat jalan" | "Rawat inap";
  readonly poli: string | null;
  readonly dokter: string | null;
  readonly penjamin: string | null;
  readonly status: string | null;
  readonly statusBayar: string | null;
}

export interface VisitDetails extends Visit {
  readonly diagnosis: ReadonlyArray<Diagnosis>;
  readonly tindakan: ReadonlyArray<string>;
  readonly obat: ReadonlyArray<{ readonly nama: string; readonly jumlah: number }>;
  readonly kamar: ReadonlyArray<{
    readonly kamar: string;
    readonly bangsal: string | null;
    readonly masuk: string | null;
    readonly keluar: string | null;
    readonly status: string | null;
  }>;
}

export interface CpptEntry {
  readonly tanggal: string | null;
  readonly jam: string | null;
  readonly petugas: string;
  readonly profesi: "Dokter" | "Perawat/tenaga lain";
  readonly layanan: "Rawat jalan" | "Rawat inap";
  readonly tandaVital: string;
  readonly subjektif: string | null;
  readonly objektif: string | null;
  readonly asesmen: string | null;
  readonly plan: string | null;
  readonly instruksi: string | null;
  readonly evaluasi: string | null;
  readonly alergi: string | null;
}

export interface LabResult {
  readonly tanggal: string | null;
  readonly jenisPemeriksaan: string | null;
  readonly item: string | null;
  readonly nilai: string | null;
  readonly satuan: string | null;
  readonly rujukan: string | null;
  readonly keterangan: string | null;
}

export interface Hospital {
  readonly nama: string;
  readonly alamat: string;
  readonly kontak: string;
  /** data: URI of the logo, if it is a PNG or JPEG under 300 kB. */
  readonly logo: string | null;
}

const notFound = (tool: string, message: string) => new ToolError({ tool, message });

export const identityOf = (tool: string, noRkmMedis: string) =>
  Effect.gen(function* () {
    const { pasien } = yield* cariPasien.handler({ noRkmMedis });
    const p = pasien[0];
    if (!p) return yield* notFound(tool, `Pasien dengan RM ${noRkmMedis} tidak ditemukan.`);
    return {
      noRkmMedis: p.no_rkm_medis,
      nama: p.nm_pasien,
      jk: p.jk,
      tglLahir: p.tgl_lahir,
      umur: p.umur,
      penjamin: p.png_jawab,
    } satisfies Identity;
  });

const toVisit = (r: Row): Visit => ({
  noRawat: String(r["no_rawat"]),
  tanggal: str(r["tgl_registrasi"]),
  jam: str(r["jam_reg"]),
  jenis: r["status_lanjut"] === "Ranap" ? "Rawat inap" : "Rawat jalan",
  poli: str(r["nm_poli"]),
  dokter: str(r["nm_dokter"]),
  penjamin: str(r["png_jawab"]),
  status: str(r["stts"]),
  statusBayar: str(r["status_bayar"]),
});

const VISIT_COLUMNS = `r.no_rawat, r.no_rkm_medis, r.tgl_registrasi, r.jam_reg, r.status_lanjut, r.stts, r.status_bayar,
  pl.nm_poli, d.nm_dokter, pj.png_jawab`;

/** One visit with the patient's RM; fails when it does not exist. */
export const visitOf = (tool: string, noRawat: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [row] = yield* read.query<Row>(
      (sql) => sql`
        SELECT ${sql.literal(VISIT_COLUMNS)}
        FROM reg_periksa r
        LEFT JOIN poliklinik pl ON pl.kd_poli = r.kd_poli
        LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
        LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
        WHERE r.no_rawat = ${noRawat}`,
    );
    if (!row) return yield* notFound(tool, `Kunjungan ${noRawat} tidak ditemukan.`);
    return { visit: toVisit(row), noRkmMedis: String(row["no_rkm_medis"]) };
  });

/** The latest visits of a patient, newest first; `more` when older visits were left out. */
export const visitsOf = (noRkmMedis: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const rows = yield* read.query<Row>(
      (sql) => sql`
        SELECT ${sql.literal(VISIT_COLUMNS)}
        FROM reg_periksa r
        LEFT JOIN poliklinik pl ON pl.kd_poli = r.kd_poli
        LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
        LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
        WHERE r.no_rkm_medis = ${noRkmMedis}
        ORDER BY r.tgl_registrasi DESC, r.jam_reg DESC
        LIMIT ${sql.literal(String(MAX_HISTORY_VISITS + 1))}`,
    );
    return { visits: rows.slice(0, MAX_HISTORY_VISITS).map(toVisit), more: rows.length > MAX_HISTORY_VISITS };
  });

const groupBy = <A>(rows: ReadonlyArray<Row>, key: string, map: (r: Row) => A) => {
  const out = new Map<string, Array<A>>();
  for (const r of rows) {
    const k = String(r[key]);
    out.set(k, [...(out.get(k) ?? []), map(r)]);
  }
  return out;
};

/** Diagnoses, tindakan, drugs and rooms for several visits, in one query each. */
export const detailsOf = (visits: ReadonlyArray<Visit>) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const ids = visits.map((v) => v.noRawat);
    if (ids.length === 0) return [] as ReadonlyArray<VisitDetails>;

    const diagnoses = yield* read.query<Row>(
      (sql) => sql`
        SELECT dp.no_rawat, dp.kd_penyakit, py.nm_penyakit, dp.prioritas
        FROM diagnosa_pasien dp LEFT JOIN penyakit py ON py.kd_penyakit = dp.kd_penyakit
        WHERE dp.no_rawat IN ${sql.in(ids)}
        ORDER BY dp.no_rawat, dp.prioritas`,
    );
    const tindakan = yield* read.query<Row>(
      (sql) => sql`
        SELECT t.no_rawat, COALESCE(j.nm_perawatan, ji.nm_perawatan, t.kd_jenis_prw) AS nama
        FROM (
          SELECT no_rawat, kd_jenis_prw, 'jl' AS jenis FROM rawat_jl_dr WHERE no_rawat IN ${sql.in(ids)}
          UNION ALL SELECT no_rawat, kd_jenis_prw, 'jl' FROM rawat_jl_pr WHERE no_rawat IN ${sql.in(ids)}
          UNION ALL SELECT no_rawat, kd_jenis_prw, 'jl' FROM rawat_jl_drpr WHERE no_rawat IN ${sql.in(ids)}
          UNION ALL SELECT no_rawat, kd_jenis_prw, 'inap' FROM rawat_inap_dr WHERE no_rawat IN ${sql.in(ids)}
          UNION ALL SELECT no_rawat, kd_jenis_prw, 'inap' FROM rawat_inap_pr WHERE no_rawat IN ${sql.in(ids)}
          UNION ALL SELECT no_rawat, kd_jenis_prw, 'inap' FROM rawat_inap_drpr WHERE no_rawat IN ${sql.in(ids)}
        ) t
        LEFT JOIN jns_perawatan j ON t.jenis = 'jl' AND j.kd_jenis_prw = t.kd_jenis_prw
        LEFT JOIN jns_perawatan_inap ji ON t.jenis = 'inap' AND ji.kd_jenis_prw = t.kd_jenis_prw
        GROUP BY t.no_rawat, nama
        ORDER BY t.no_rawat, nama`,
    );
    const obat = yield* read.query<Row>(
      (sql) => sql`
        SELECT o.no_rawat, COALESCE(b.nama_brng, o.kode_brng) AS nama, SUM(o.jml) AS jumlah
        FROM detail_pemberian_obat o LEFT JOIN databarang b ON b.kode_brng = o.kode_brng
        WHERE o.no_rawat IN ${sql.in(ids)}
        GROUP BY o.no_rawat, nama
        ORDER BY o.no_rawat, nama`,
    );
    const kamar = yield* read.query<Row>(
      (sql) => sql`
        SELECT ki.no_rawat, ki.kd_kamar, b.nm_bangsal, ki.tgl_masuk, ki.jam_masuk, ki.tgl_keluar, ki.jam_keluar,
          ki.stts_pulang
        FROM kamar_inap ki
        LEFT JOIN kamar k ON k.kd_kamar = ki.kd_kamar
        LEFT JOIN bangsal b ON b.kd_bangsal = k.kd_bangsal
        WHERE ki.no_rawat IN ${sql.in(ids)}
        ORDER BY ki.no_rawat, ki.tgl_masuk, ki.jam_masuk`,
    );

    const diagnosisBy = groupBy(diagnoses, "no_rawat", (r) => ({
      kode: String(r["kd_penyakit"]),
      nama: str(r["nm_penyakit"]),
      prioritas: Number(r["prioritas"] ?? 0),
    }));
    const tindakanBy = groupBy(tindakan, "no_rawat", (r) => String(r["nama"]));
    const obatBy = groupBy(obat, "no_rawat", (r) => ({ nama: String(r["nama"]), jumlah: Number(r["jumlah"] ?? 0) }));
    const kamarBy = groupBy(kamar, "no_rawat", (r) => {
      const keluar = str(r["tgl_keluar"]);
      return {
        kamar: String(r["kd_kamar"]),
        bangsal: str(r["nm_bangsal"]),
        masuk: [str(r["tgl_masuk"]), str(r["jam_masuk"])].filter(Boolean).join(" ") || null,
        keluar: keluar && keluar !== "0000-00-00" ? [keluar, str(r["jam_keluar"])].filter(Boolean).join(" ") : null,
        status: r["stts_pulang"] === "-" ? "aktif" : str(r["stts_pulang"]),
      };
    });

    return visits.map(
      (v): VisitDetails => ({
        ...v,
        diagnosis: diagnosisBy.get(v.noRawat) ?? [],
        tindakan: tindakanBy.get(v.noRawat) ?? [],
        obat: obatBy.get(v.noRawat) ?? [],
        kamar: kamarBy.get(v.noRawat) ?? [],
      }),
    );
  });

const vitals = (r: Row) =>
  [
    r["suhu_tubuh"] && `Suhu ${String(r["suhu_tubuh"])} °C`,
    r["tensi"] && `TD ${String(r["tensi"])} mmHg`,
    r["nadi"] && `Nadi ${String(r["nadi"])}/mnt`,
    r["respirasi"] && `RR ${String(r["respirasi"])}/mnt`,
    r["spo2"] && `SpO₂ ${String(r["spo2"])}%`,
    r["gcs"] && `GCS ${String(r["gcs"])}`,
    r["kesadaran"] && String(r["kesadaran"]),
    r["tinggi"] && `TB ${String(r["tinggi"])} cm`,
    r["berat"] && `BB ${String(r["berat"])} kg`,
  ]
    .filter(Boolean)
    .join(" · ");

/** CPPT / SOAP entries of a visit (outpatient and inpatient), oldest first. */
export const cpptOf = (noRawat: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const columns = `x.tgl_perawatan, x.jam_rawat, x.suhu_tubuh, x.tensi, x.nadi, x.respirasi, x.spo2, x.gcs, x.kesadaran,
      x.tinggi, x.berat, x.keluhan, x.pemeriksaan, x.alergi, x.penilaian, x.rtl, x.instruksi, x.evaluasi, x.nip`;
    const rows = yield* read.query<Row>(
      (sql) => sql`
        SELECT c.*, COALESCE(d.nm_dokter, pt.nama, c.nip) AS petugas, d.kd_dokter IS NOT NULL AS dokter
        FROM (
          SELECT 'Rawat jalan' AS layanan, ${sql.literal(columns)} FROM pemeriksaan_ralan x WHERE x.no_rawat = ${noRawat}
          UNION ALL
          SELECT 'Rawat inap' AS layanan, ${sql.literal(columns)} FROM pemeriksaan_ranap x WHERE x.no_rawat = ${noRawat}
        ) c
        LEFT JOIN dokter d ON d.kd_dokter = c.nip
        LEFT JOIN petugas pt ON pt.nip = c.nip
        ORDER BY c.tgl_perawatan, c.jam_rawat
        LIMIT ${sql.literal(String(MAX_CPPT_ROWS))}`,
    );
    return rows.map(
      (r): CpptEntry => ({
        tanggal: str(r["tgl_perawatan"]),
        jam: str(r["jam_rawat"]),
        petugas: String(r["petugas"] ?? "?"),
        profesi: Number(r["dokter"]) === 1 ? "Dokter" : "Perawat/tenaga lain",
        layanan: r["layanan"] === "Rawat inap" ? "Rawat inap" : "Rawat jalan",
        tandaVital: vitals(r),
        subjektif: str(r["keluhan"]),
        objektif: str(r["pemeriksaan"]),
        asesmen: str(r["penilaian"]),
        plan: str(r["rtl"]),
        instruksi: str(r["instruksi"]),
        evaluasi: str(r["evaluasi"]),
        alergi: str(r["alergi"]),
      }),
    );
  });

export const labOf = (noRawat: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const rows = yield* read.query<Row>(
      (sql) => sql`
        SELECT dl.tgl_periksa, j.nm_perawatan, t.Pemeriksaan AS item, dl.nilai, t.satuan, dl.nilai_rujukan, dl.keterangan
        FROM detail_periksa_lab dl
        LEFT JOIN template_laboratorium t ON t.id_template = dl.id_template
        LEFT JOIN jns_perawatan_lab j ON j.kd_jenis_prw = dl.kd_jenis_prw
        WHERE dl.no_rawat = ${noRawat}
        ORDER BY dl.tgl_periksa, dl.jam, t.urut`,
    );
    return rows.map(
      (r): LabResult => ({
        tanggal: str(r["tgl_periksa"]),
        jenisPemeriksaan: str(r["nm_perawatan"]),
        item: str(r["item"]),
        nilai: str(r["nilai"]),
        satuan: str(r["satuan"]),
        rujukan: str(r["nilai_rujukan"]),
        keterangan: str(r["keterangan"]),
      }),
    );
  });

export const radiologyOf = (noRawat: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const rows = yield* read.query<Row>(
      (sql) => sql`SELECT tgl_periksa, jam, hasil FROM hasil_radiologi WHERE no_rawat = ${noRawat} ORDER BY tgl_periksa, jam`,
    );
    return rows.map((r) => ({ tanggal: str(r["tgl_periksa"]), laporanRadiologi: str(r["hasil"]) }));
  });

/** Labelled fields of the resume written in Khanza, or null when there is none. */
export const resumeOf = (noRawat: string, inpatient: boolean) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const common = `r.keluhan_utama, r.jalannya_penyakit, r.pemeriksaan_penunjang, r.hasil_laborat, r.diagnosa_utama,
      r.kd_diagnosa_utama, r.diagnosa_sekunder, r.kd_diagnosa_sekunder, r.prosedur_utama, r.kd_prosedur_utama,
      r.obat_pulang, d.nm_dokter`;
    const [row] = inpatient
      ? yield* read.query<Row>(
          (sql) => sql`
            SELECT ${sql.literal(common)}, r.diagnosa_awal, r.alasan, r.pemeriksaan_fisik, r.tindakan_dan_operasi,
              r.obat_di_rs, r.alergi, r.diet, r.edukasi, r.cara_keluar, r.keadaan, r.dilanjutkan
            FROM resume_pasien_ranap r LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
            WHERE r.no_rawat = ${noRawat}`,
        )
      : yield* read.query<Row>(
          (sql) => sql`
            SELECT ${sql.literal(common)}, r.kondisi_pulang
            FROM resume_pasien r LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
            WHERE r.no_rawat = ${noRawat}`,
        );
    if (!row) return null;
    const code = (name: unknown, kode: unknown) => [str(name), str(kode) && `(${String(kode)})`].filter(Boolean).join(" ") || null;
    return {
      dokter: str(row["nm_dokter"]),
      bagian: [
        ["Diagnosa awal", str(row["diagnosa_awal"])],
        ["Alasan dirawat", str(row["alasan"])],
        ["Keluhan utama", str(row["keluhan_utama"])],
        ["Pemeriksaan fisik", str(row["pemeriksaan_fisik"])],
        ["Jalannya penyakit", str(row["jalannya_penyakit"])],
        ["Pemeriksaan penunjang", str(row["pemeriksaan_penunjang"])],
        ["Hasil laboratorium", str(row["hasil_laborat"])],
        ["Tindakan / operasi", str(row["tindakan_dan_operasi"])],
        ["Obat selama dirawat", str(row["obat_di_rs"])],
        ["Diagnosa utama", code(row["diagnosa_utama"], row["kd_diagnosa_utama"])],
        ["Diagnosa sekunder", code(row["diagnosa_sekunder"], row["kd_diagnosa_sekunder"])],
        ["Prosedur utama", code(row["prosedur_utama"], row["kd_prosedur_utama"])],
        ["Alergi", str(row["alergi"])],
        ["Diet", str(row["diet"])],
        ["Edukasi", str(row["edukasi"])],
        ["Cara keluar", str(row["cara_keluar"])],
        ["Keadaan pulang", str(row["keadaan"] ?? row["kondisi_pulang"])],
        ["Dilanjutkan", str(row["dilanjutkan"])],
        ["Obat pulang", str(row["obat_pulang"])],
      ].flatMap(([label, value]) => (value ? [{ label: label as string, isiResume: value }] : [])),
    };
  });

const imageType = (bytes: Uint8Array) =>
  bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : null;

/** Hospital name, address and logo for the document header (from Khanza `setting`). */
export const hospital = Effect.gen(function* () {
  const read = yield* KhanzaRead;
  const [row] = yield* read.query<Row>(
    (sql) => sql`SELECT nama_instansi, alamat_instansi, kabupaten, propinsi, kontak, email, logo FROM setting LIMIT 1`,
  );
  const logo = row?.["logo"];
  const bytes = logo instanceof Uint8Array && logo.length > 0 && logo.length < 300_000 ? logo : null;
  const type = bytes ? imageType(bytes) : null;
  return {
    nama: str(row?.["nama_instansi"]) ?? "Rumah Sakit",
    alamat: [row?.["alamat_instansi"], row?.["kabupaten"], row?.["propinsi"]].map(str).filter(Boolean).join(", "),
    kontak: [row?.["kontak"], row?.["email"]].map(str).filter(Boolean).join(" · "),
    logo: bytes && type ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}` : null,
  } satisfies Hospital;
});

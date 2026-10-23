/**
 * Radiology of a visit (or a patient) in one card: the exams and readings
 * from Khanza (periksa_radiologi + jns_perawatan_radiologi + hasil_radiologi)
 * and the images from the Orthanc PACS, matched by No. RM = DICOM PatientID.
 * Khanza's own `gambar_radiologi` table is often empty because images go
 * straight from the modality to Orthanc, so images always come from Orthanc.
 *
 * With a noRawat, PACS studies are narrowed to the visit's dates: registration
 * until discharge (today while still admitted), widened by the exam dates and
 * one extra day, because a late or night exam is often dated the next day.
 *
 * When PACS is not set up or not reachable, the readings are still shown.
 */
import type { PacsStudy, RadiologyExam } from "@simrs/shared";
import { RadiologyGallery } from "@simrs/shared";
import { Effect, Schema } from "effect";
import { ToolError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { NoRawat, NoRkmMedis } from "../read/common.ts";
import { defineTool } from "../tool.ts";
import { Pacs } from "./Pacs.ts";

const NAME = "hasilRadiologi";
/** Most exams listed for a patient (newest first). */
const MAX_EXAMS = 30;

type Row = Record<string, unknown>;

const str = (value: unknown): string | null => (value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim());
const today = () => new Date().toLocaleDateString("sv-SE");
const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isDay = (value: string | null): value is string => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000");

/** Exams with their readings, newest first. Readings without an exam row are kept too. */
const examsOf = (where: { readonly noRawat: string } | { readonly noRkmMedis: string }) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const visits = (sql: Parameters<Parameters<typeof read.query>[0]>[0], column: string) =>
      "noRawat" in where
        ? sql`${sql.literal(column)} = ${where.noRawat}`
        : sql`${sql.literal(column)} IN (SELECT no_rawat FROM reg_periksa WHERE no_rkm_medis = ${where.noRkmMedis})`;
    const exams = yield* read.query<Row>(
      (sql) => sql`
        SELECT p.no_rawat, DATE_FORMAT(p.tgl_periksa, '%Y-%m-%d') AS tanggal, TIME_FORMAT(p.jam, '%H:%i') AS jam,
               GROUP_CONCAT(DISTINCT COALESCE(j.nm_perawatan, p.kd_jenis_prw) ORDER BY j.nm_perawatan SEPARATOR ', ') AS nama,
               MAX(d.nm_dokter) AS dokter
        FROM periksa_radiologi p
        LEFT JOIN jns_perawatan_radiologi j ON j.kd_jenis_prw = p.kd_jenis_prw
        LEFT JOIN dokter d ON d.kd_dokter = p.kd_dokter
        WHERE ${visits(sql, "p.no_rawat")}
        GROUP BY p.no_rawat, p.tgl_periksa, p.jam
        ORDER BY p.tgl_periksa DESC, p.jam DESC
        LIMIT ${sql.literal(String(MAX_EXAMS))}`,
    );
    const readings = yield* read.query<Row>(
      (sql) => sql`
        SELECT h.no_rawat, DATE_FORMAT(h.tgl_periksa, '%Y-%m-%d') AS tanggal, TIME_FORMAT(h.jam, '%H:%i') AS jam, h.hasil
        FROM hasil_radiologi h
        WHERE ${visits(sql, "h.no_rawat")}
        ORDER BY h.tgl_periksa DESC, h.jam DESC
        LIMIT ${sql.literal(String(MAX_EXAMS))}`,
    );
    const key = (r: Row) => `${String(r["no_rawat"])}|${String(r["tanggal"])}|${String(r["jam"])}`;
    const reading = new Map(readings.map((r) => [key(r), str(r["hasil"])]));
    const list: Array<RadiologyExam> = exams.map((r) => ({
      noRawat: String(r["no_rawat"]),
      tanggal: String(r["tanggal"] ?? ""),
      jam: String(r["jam"] ?? ""),
      nama: str(r["nama"]),
      dokter: str(r["dokter"]),
      hasil: reading.get(key(r)) ?? null,
    }));
    const listed = new Set(exams.map(key));
    for (const r of readings) {
      if (!listed.has(key(r))) {
        list.push({ noRawat: String(r["no_rawat"]), tanggal: String(r["tanggal"] ?? ""), jam: String(r["jam"] ?? ""), nama: null, dokter: null, hasil: str(r["hasil"]) });
      }
    }
    return list.toSorted((a, b) => (b.tanggal + b.jam).localeCompare(a.tanggal + a.jam)).slice(0, MAX_EXAMS);
  });

/** No. RM and the date range of a visit. */
const visitOf = (noRawat: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [row] = yield* read.query<Row>(
      (sql) => sql`
        SELECT r.no_rkm_medis, DATE_FORMAT(r.tgl_registrasi, '%Y-%m-%d') AS masuk,
          (SELECT DATE_FORMAT(MAX(tgl_keluar), '%Y-%m-%d') FROM kamar_inap WHERE no_rawat = r.no_rawat AND tgl_keluar > '0000-00-00') AS keluar,
          (SELECT COUNT(*) FROM kamar_inap WHERE no_rawat = r.no_rawat AND stts_pulang = '-') AS aktif
        FROM reg_periksa r WHERE r.no_rawat = ${noRawat}`,
    );
    if (!row) return yield* new ToolError({ tool: NAME, message: `Kunjungan ${noRawat} tidak ditemukan.` });
    return { noRkmMedis: String(row["no_rkm_medis"]), masuk: str(row["masuk"]), keluar: str(row["keluar"]), dirawat: Number(row["aktif"] ?? 0) > 0 };
  });

export const hasilRadiologi = defineTool({
  name: NAME,
  kind: "render",
  description:
    "Radiology of a visit or patient in ONE card: the exams and the radiologist's reading (hasil baca / expertise) " +
    "from Khanza, together with the images (foto rontgen/thorax, CT, MRI) from the hospital's PACS, with a viewer. " +
    "Use this for every radiology question: hasil radiologi, hasil baca, expertise, foto, gambar, PACS. Give noRawat " +
    "for one visit, or noRkmMedis for a patient's latest exams. Do not query hasil_radiologi, periksa_radiologi or " +
    "gambar_radiologi yourself, and do not call tampilkan for it: this card already shows everything. The card is " +
    "shown to the user automatically; do not repeat or summarise its contents unless the user asks. You cannot see " +
    "the images; never describe or interpret them.",
  parameters: Schema.Struct({
    noRawat: Schema.optionalKey(NoRawat),
    noRkmMedis: Schema.optionalKey(NoRkmMedis),
  }),
  output: Schema.Struct({ gallery: RadiologyGallery }),
  forModel: ({ gallery }) => ({
    noRkmMedis: gallery.noRkmMedis,
    noRawat: gallery.noRawat,
    // Not "pemeriksaan": that field name is masked as clinical text (CPPT exam notes).
    daftarRadiologi: gallery.pemeriksaan.map((e) => ({
      noRawat: e.noRawat,
      tanggal: e.tanggal,
      jam: e.jam,
      nama: e.nama,
      dokter: e.dokter,
      // Field name masked for external AI providers (privacy/mask.ts), like other clinical text.
      laporanRadiologi: e.hasil ?? "(belum ada hasil baca)",
    })),
    gambarPacs: gallery.pacsCatatan ?? gallery.studies.map((s) => ({ tanggal: s.date, jumlahGambar: s.series.reduce((n, se) => n + se.instances.length, 0) })),
    catatan:
      "Kartu dengan hasil baca dan gambar sudah tampil di layar. Jangan ulangi atau ringkas isinya kecuali diminta; " +
      "cukup satu kalimat pendek. Kamu tidak bisa melihat gambarnya.",
  }),
  handler: Effect.fn(NAME)(function* (params) {
    const pacs = yield* Pacs;
    const noRawat = params.noRawat?.trim() || null;
    const visit = noRawat ? yield* visitOf(noRawat) : null;
    const noRkmMedis = visit?.noRkmMedis ?? params.noRkmMedis?.trim();
    if (!noRkmMedis) return yield* new ToolError({ tool: NAME, message: "Butuh noRawat atau noRkmMedis." });

    const pemeriksaan = yield* examsOf(noRawat ? { noRawat } : { noRkmMedis });

    // PACS window: the visit, widened by its exam dates, plus a day for night exams.
    let rentang: { readonly dari: string; readonly sampai: string } | null = null;
    if (visit) {
      const days = [visit.masuk, visit.keluar, ...pemeriksaan.map((e) => e.tanggal)].filter(isDay).toSorted();
      const dari = days[0] ?? today();
      const sampai = visit.dirawat ? today() : addDays(days.at(-1) ?? dari, 1);
      rentang = { dari, sampai: sampai < dari ? dari : sampai };
    }

    let studies: ReadonlyArray<PacsStudy> = [];
    let pacsCatatan: string | null = null;
    let cocokKunjungan = true;
    if (!pacs.configured) pacsCatatan = "PACS (Orthanc) belum diatur di server, jadi gambar tidak bisa ditampilkan.";
    else if (/[*?\\]/.test(noRkmMedis)) pacsCatatan = "Nomor RM berisi * atau ?, jadi PACS tidak dicari.";
    else {
      const found = yield* pacs.studies(noRkmMedis).pipe(
        Effect.map((all) => ({ all, error: null as string | null })),
        Effect.catch((e) => Effect.succeed({ all: [] as ReadonlyArray<PacsStudy>, error: e.message })),
      );
      pacsCatatan = found.error;
      const range = rentang;
      const inVisit = range ? found.all.filter((s) => s.date !== "" && s.date >= range.dari && s.date <= range.sampai) : found.all;
      cocokKunjungan = range === null || inVisit.length > 0 || found.all.length === 0;
      // Nothing in the visit dates: show the patient's other studies only when Khanza has no exam either.
      studies = cocokKunjungan ? inVisit : pemeriksaan.length === 0 ? found.all : [];
    }

    return {
      gallery: { pemeriksaan, pacsCatatan, noRkmMedis, noRawat, rentang, cocokKunjungan, viewerBase: pacs.viewerBase, studies },
    };
  }),
});

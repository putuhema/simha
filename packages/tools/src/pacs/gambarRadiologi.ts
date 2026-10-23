/**
 * Shows a patient's radiology images (X-ray, CT, ...) from the Orthanc PACS
 * as a card in the chat. Khanza's own `gambar_radiologi` table is often empty
 * because images go straight from the modality to Orthanc, so this asks
 * Orthanc directly: studies are matched by No. RM = DICOM PatientID.
 *
 * With a noRawat, studies are narrowed to the visit's dates: registration
 * until discharge (today while still admitted), widened by the radiology
 * result dates and one extra day, because an exam late in the evening or a
 * night shift is often dated the next day in the PACS.
 */
import { RadiologyGallery } from "@simrs/shared";
import { Effect, Schema } from "effect";
import { ToolError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { NoRawat, NoRkmMedis } from "../read/common.ts";
import { defineTool } from "../tool.ts";
import { Pacs } from "./Pacs.ts";

const NAME = "gambarRadiologi";

const isoDay = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !text.startsWith("0000") ? text : null;
};
const today = () => new Date().toLocaleDateString("sv-SE");
const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** No. RM and the date range of a visit. */
const visitWindow = (noRawat: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const [visit] = yield* read.query<{ no_rkm_medis: unknown; tgl_registrasi: unknown }>(
      (sql) => sql`SELECT no_rkm_medis, DATE_FORMAT(tgl_registrasi, '%Y-%m-%d') AS tgl_registrasi FROM reg_periksa WHERE no_rawat = ${noRawat}`,
    );
    if (!visit) return yield* new ToolError({ tool: NAME, message: `Kunjungan ${noRawat} tidak ditemukan.` });
    const [stay] = yield* read.query<{ keluar: unknown; aktif: unknown; hasil: unknown }>(
      (sql) => sql`
        SELECT
          (SELECT DATE_FORMAT(MAX(tgl_keluar), '%Y-%m-%d') FROM kamar_inap WHERE no_rawat = ${noRawat} AND tgl_keluar > '0000-00-00') AS keluar,
          (SELECT COUNT(*) FROM kamar_inap WHERE no_rawat = ${noRawat} AND stts_pulang = '-') AS aktif,
          (SELECT DATE_FORMAT(MAX(tgl_periksa), '%Y-%m-%d') FROM hasil_radiologi WHERE no_rawat = ${noRawat}) AS hasil`,
    );
    const start = isoDay(visit.tgl_registrasi) ?? today();
    const stillAdmitted = Number(stay?.aktif ?? 0) > 0;
    const last = [start, isoDay(stay?.keluar), isoDay(stay?.hasil)].filter((d): d is string => d !== null).toSorted().at(-1) ?? start;
    const end = stillAdmitted ? today() : addDays(last, 1);
    return { noRkmMedis: String(visit.no_rkm_medis), dari: start, sampai: end < start ? start : end };
  });

export const gambarRadiologi = defineTool({
  name: NAME,
  kind: "render",
  description:
    "Show the radiology IMAGES (foto rontgen/thorax, CT, MRI, ...) of a patient from the hospital's PACS (Orthanc) " +
    "as a card with thumbnails and a viewer in the chat. Use this whenever the user asks to see/show (tampilkan, " +
    "lihat, buka) a radiology photo or PACS image. Give noRawat to show the studies of one visit, or noRkmMedis for " +
    "all of a patient's studies. Do NOT look for images in gambar_radiologi or other Khanza tables: images live in " +
    "the PACS, not in Khanza. The card is shown to the user automatically; in your answer only say briefly what was " +
    "found (date, exam, number of images). You cannot see the images yourself, so never describe or interpret them.",
  parameters: Schema.Struct({
    noRawat: Schema.optionalKey(NoRawat),
    noRkmMedis: Schema.optionalKey(NoRkmMedis),
  }),
  output: Schema.Struct({ gallery: RadiologyGallery }),
  forModel: ({ gallery }) => ({
    noRkmMedis: gallery.noRkmMedis,
    noRawat: gallery.noRawat,
    rentangKunjungan: gallery.rentang,
    cocokKunjungan: gallery.cocokKunjungan,
    jumlahStudi: gallery.studies.length,
    studi: gallery.studies.map((s) => ({
      tanggal: s.date,
      jam: s.time,
      pemeriksaan: s.description || null,
      modalitas: [...new Set(s.series.map((se) => se.modality).filter(Boolean))],
      seri: s.series.map((se) => se.description || se.bodyPart || null),
      jumlahGambar: s.series.reduce((n, se) => n + se.instances.length, 0),
    })),
    catatan: "Kartu gambar sudah ditampilkan ke pengguna. Kamu tidak bisa melihat gambarnya; jangan menafsirkan.",
  }),
  handler: Effect.fn(NAME)(function* (params) {
    const pacs = yield* Pacs;
    if (!pacs.configured) {
      return yield* new ToolError({
        tool: NAME,
        message: "PACS (Orthanc) belum diatur di server (ORTHANC_URL kosong), jadi gambar radiologi tidak bisa ditampilkan.",
      });
    }
    const noRawat = params.noRawat?.trim() || null;
    const visit = noRawat ? yield* visitWindow(noRawat) : null;
    const noRkmMedis = visit?.noRkmMedis ?? params.noRkmMedis?.trim();
    if (!noRkmMedis) return yield* new ToolError({ tool: NAME, message: "Butuh noRawat atau noRkmMedis." });
    if (/[*?\\]/.test(noRkmMedis)) return yield* new ToolError({ tool: NAME, message: "Nomor RM tidak boleh berisi * atau ?." });

    const all = yield* pacs.studies(noRkmMedis).pipe(Effect.mapError((e) => new ToolError({ tool: NAME, message: e.message })));
    const inVisit = visit ? all.filter((s) => s.date !== "" && s.date >= visit.dari && s.date <= visit.sampai) : all;
    const matched = visit === null || inVisit.length > 0;
    return {
      gallery: {
        noRkmMedis,
        noRawat,
        rentang: visit ? { dari: visit.dari, sampai: visit.sampai } : null,
        cocokKunjungan: matched,
        viewerBase: pacs.viewerBase,
        studies: matched ? inVisit : all,
      },
    };
  }),
});

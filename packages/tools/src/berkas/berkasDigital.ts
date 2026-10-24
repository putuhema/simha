/**
 * Digital patient files (berkas digital) of a visit or a patient: scans of
 * lab results, radiology PDFs, photos and consent forms uploaded in Khanza.
 * The AI gets the list and the file types, never the bytes; the card shows
 * image thumbnails and PDF links, and every file is streamed by the
 * authenticated /api/berkas route.
 *
 * Files live outside the database. When KHANZA_BERKAS_DIR is not set (or a
 * file is missing) the list is still shown, with a note, but files cannot be
 * opened. Nothing here reads a file's contents.
 */
import { BerkasDigital, type BerkasDigitalFile } from "@simha/shared";
import { Effect, Result, Schema } from "effect";
import { identityOf, visitOf } from "../documents/data.ts";
import { ToolError } from "../errors.ts";
import { CurrentPermissions } from "../khanza/current-tool-call.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { NoRawat, NoRkmMedis } from "../read/common.ts";
import { defineTool, requirePermission } from "../tool.ts";
import { Berkas } from "./Berkas.ts";
import { berkasKindOf } from "./Berkas.ts";

const NAME = "berkasDigital";
/** Most files listed in one card. */
const MAX_FILES = 50;

type Row = Record<string, unknown>;

const str = (value: unknown): string | null =>
  value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim();

const baseName = (lokasi: string) => lokasi.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";

export const berkasDigital = defineTool({
  name: NAME,
  kind: "render",
  requires: (permissions) => permissions.berkas,
  description:
    "Digital files (berkas digital) of a visit or patient from Khanza: scanned lab results, radiology PDFs, photos, " +
    "consent forms and other uploads, shown as one card with image thumbnails and PDF links. Use this for 'berkas " +
    "digital', 'file pasien', 'hasil scan', 'hasil lab PDF', 'foto berkas', or when the user asks to see uploaded " +
    "documents. Give noRawat for one visit, or noRkmMedis for the patient's visits. Do not query " +
    "berkas_digital_perawatan or master_berkas_digital yourself, and do not call tampilkan for this. You cannot read " +
    "the file contents; never describe or interpret an image or PDF. The card is shown automatically: do not repeat " +
    "the file list in your answer unless asked.",
  parameters: Schema.Struct({
    noRawat: Schema.optionalKey(NoRawat),
    noRkmMedis: Schema.optionalKey(NoRkmMedis),
  }),
  output: Schema.Struct({ berkas: BerkasDigital }),
  handler: Effect.fn(NAME)(function* (params) {
    const permissions = yield* CurrentPermissions;
    yield* requirePermission(
      NAME,
      permissions.berkas,
      "Akun SIMRS Anda tidak punya hak `berkas_digital_perawatan`, jadi berkas digital tidak bisa dibuka.",
    );
    const read = yield* KhanzaRead;
    const files = yield* Berkas;
    const noRawat = params.noRawat?.trim() || null;
    const visit = noRawat ? yield* visitOf(NAME, noRawat) : null;
    const noRkmMedis = visit?.noRkmMedis ?? params.noRkmMedis?.trim();
    if (!noRkmMedis) return yield* new ToolError({ tool: NAME, message: "Butuh noRawat atau noRkmMedis." });
    const identity = yield* identityOf(NAME, noRkmMedis);
    const subjek = `RM ${noRkmMedis} · ${identity.nama ?? ""}${noRawat ? ` · ${noRawat}` : ""}`;

    const rowsResult = yield* read
      .query<Row>(
        (sql) =>
          noRawat
            ? sql`
                SELECT b.no_rawat, b.kode, COALESCE(m.nama, b.kode) AS nama, b.lokasi_file
                FROM berkas_digital_perawatan b
                LEFT JOIN master_berkas_digital m ON m.kode = b.kode
                WHERE b.no_rawat = ${noRawat}
                ORDER BY m.nama, b.kode
                LIMIT ${sql.literal(String(MAX_FILES + 1))}`
            : sql`
                SELECT b.no_rawat, b.kode, COALESCE(m.nama, b.kode) AS nama, b.lokasi_file
                FROM berkas_digital_perawatan b
                LEFT JOIN master_berkas_digital m ON m.kode = b.kode
                WHERE b.no_rawat IN (SELECT no_rawat FROM reg_periksa WHERE no_rkm_medis = ${noRkmMedis})
                ORDER BY b.no_rawat DESC, m.nama, b.kode
                LIMIT ${sql.literal(String(MAX_FILES + 1))}`,
      )
      .pipe(Effect.result);

    if (Result.isFailure(rowsResult)) {
      return {
        berkas: {
          noRkmMedis,
          noRawat,
          subjek,
          berkas: [],
          catatan: "Tabel berkas digital tidak bisa dibaca dari database Khanza ini.",
        },
      };
    }

    const rows = rowsResult.success;
    const listed = rows.slice(0, MAX_FILES);
    const berkas: Array<BerkasDigitalFile> = [];
    for (const row of listed) {
      const lokasi = str(row["lokasi_file"]) ?? "";
      const namaFile = baseName(lokasi);
      const info = yield* files.info(lokasi).pipe(Effect.result);
      berkas.push({
        noRawat: String(row["no_rawat"]),
        kode: String(row["kode"]),
        nama: str(row["nama"]) ?? String(row["kode"]),
        namaFile: namaFile === "" ? "berkas" : namaFile,
        jenis: berkasKindOf(namaFile),
        ukuran: Result.isSuccess(info) ? info.success.ukuran : null,
        ada: Result.isSuccess(info),
      });
    }

    const missing = berkas.filter((file) => !file.ada).length;
    const catatan = !files.configured
      ? "Sumber berkas digital belum diatur di server (KHANZA_BERKAS_URL atau KHANZA_BERKAS_DIR), jadi daftar ini belum bisa dibuka."
      : missing > 0
        ? `${missing} berkas tidak ditemukan atau tidak bisa dibuka di server (periksa KHANZA_BERKAS_URL/DIR).`
        : rows.length > MAX_FILES
          ? `Hanya ${MAX_FILES} berkas pertama yang ditampilkan.`
          : null;

    return { berkas: { noRkmMedis, noRawat, subjek, berkas, catatan } };
  }),
  forModel: ({ berkas }) => ({
    noRkmMedis: berkas.noRkmMedis,
    noRawat: berkas.noRawat,
    daftarBerkas: berkas.berkas.map((file) => ({
      jenis: file.jenis,
      nama: file.nama,
      file: file.namaFile,
      ukuran: file.ukuran,
      ada: file.ada,
    })),
    catatan:
      "Kartu berkas digital sudah tampil di layar. Kamu tidak bisa melihat atau membaca isi gambar/PDF; jangan " +
      "mengarang isinya. Cukup satu kalimat pendek kalau perlu, jangan ulangi daftar berkas.",
  }),
});

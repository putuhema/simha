import { Effect, Schema } from "effect";
import { ToolError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { ACTIVE_STAY, containsWords, NullableNum, NullableStr, Str } from "./common.ts";

const MAX_RESULTS = 100;

const KamarRow = Schema.Struct({
  kd_kamar: Str,
  kd_bangsal: NullableStr,
  nm_bangsal: NullableStr,
  kelas: NullableStr,
  status: NullableStr,
  statusdata: NullableStr,
  trf_kamar: NullableNum,
  pasien_aktif: Schema.Number,
});

/** Flags rooms whose `kamar.status` disagrees with the active kamar_inap rows. */
export const roomNote = (row: { status: string | null; pasien_aktif: number }): string | null => {
  if (row.status === "ISI" && row.pasien_aktif === 0) return "Status ISI tetapi tidak ada pasien aktif di kamar ini.";
  if (row.status !== "ISI" && row.pasien_aktif > 0) {
    return `Status ${row.status ?? "kosong"} tetapi ada ${row.pasien_aktif} pasien aktif di kamar ini.`;
  }
  if (row.pasien_aktif > 1) return `Ada ${row.pasien_aktif} pasien aktif di satu kamar.`;
  return null;
};

export const statusKamar = defineTool({
  name: "statusKamar",
  kind: "read",
  description:
    "Status of rooms (kamar): by room code (kdKamar), ward code (kdBangsal) or ward name (namaBangsal, e.g. " +
    "'Mawar'). For each room: ward, class, kamar.status (ISI/KOSONG/DIBERSIHKAN/DIBOOKING), statusdata " +
    "('1' = in use), and pasien_aktif = number of active kamar_inap rows in it. 'bisaDipakai' is true only " +
    "when the room is KOSONG, in use and has no active patient. 'catatan' explains mismatches, e.g. a room " +
    `marked ISI with nobody in it. At most ${MAX_RESULTS} rooms.`,
  parameters: Schema.Struct({
    kdKamar: Schema.optionalKey(Str.annotate({ description: "Exact room code (kd_kamar)." })),
    kdBangsal: Schema.optionalKey(Str.annotate({ description: "Exact ward code (kd_bangsal)." })),
    namaBangsal: Schema.optionalKey(Str.annotate({ description: "Part of the ward name, e.g. 'Mawar'." })),
  }),
  output: Schema.Struct({
    kamar: Schema.Array(
      Schema.Struct({ ...KamarRow.fields, bisaDipakai: Schema.Boolean, catatan: NullableStr }),
    ),
    lebihBanyak: Schema.Boolean,
  }),
  handler: Effect.fn("statusKamar")(function* (params) {
    const read = yield* KhanzaRead;
    const kdKamar = params.kdKamar?.trim();
    const kdBangsal = params.kdBangsal?.trim();
    const namaBangsal = params.namaBangsal?.trim();
    if (!kdKamar && !kdBangsal && !namaBangsal) {
      return yield* new ToolError({ tool: "statusKamar", message: "Isi salah satu: kdKamar, kdBangsal atau namaBangsal." });
    }
    const rows = yield* read.query((sql) => {
      const where = kdKamar
        ? sql`k.kd_kamar = ${kdKamar}`
        : kdBangsal
          ? sql`k.kd_bangsal = ${kdBangsal}`
          : sql`b.nm_bangsal LIKE ${containsWords(namaBangsal ?? "")}`;
      return sql`
        SELECT k.kd_kamar, k.kd_bangsal, b.nm_bangsal, k.kelas, k.status, k.statusdata, k.trf_kamar,
               (SELECT COUNT(*) FROM kamar_inap ki
                 WHERE ki.kd_kamar = k.kd_kamar AND ki.stts_pulang = ${ACTIVE_STAY}) AS pasien_aktif
        FROM kamar k
        LEFT JOIN bangsal b ON b.kd_bangsal = k.kd_bangsal
        WHERE ${where}
        ORDER BY k.kd_bangsal, k.kd_kamar
        LIMIT ${sql.literal(String(MAX_RESULTS + 1))}`;
    });
    const kamar = (yield* decodeRows("statusKamar", KamarRow)(rows)).map((row) => ({
      ...row,
      bisaDipakai: row.status === "KOSONG" && row.statusdata === "1" && row.pasien_aktif === 0,
      catatan: roomNote(row),
    }));
    return { kamar: kamar.slice(0, MAX_RESULTS), lebihBanyak: kamar.length > MAX_RESULTS };
  }),
});

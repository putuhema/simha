import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { ACTIVE_STAY, NoRawat, NullableNum, NullableStr, Str } from "./common.ts";

const KamarInapRow = Schema.Struct({
  kd_kamar: Str,
  kd_bangsal: NullableStr,
  nm_bangsal: NullableStr,
  kelas: NullableStr,
  trf_kamar: NullableNum,
  tgl_masuk: Str,
  jam_masuk: Str,
  tgl_keluar: NullableStr,
  jam_keluar: NullableStr,
  lama: NullableNum,
  ttl_biaya: NullableNum,
  stts_pulang: Str,
  diagnosa_awal: NullableStr,
});

export const riwayatKamar = defineTool({
  name: "riwayatKamar",
  kind: "read",
  description:
    "All rooms (kamar_inap rows) of one inpatient stay, oldest first, with ward (bangsal), class, in/out " +
    "times and stts_pulang. A row with stts_pulang '-' is active (patient is still there; tgl_keluar is " +
    "then '0000-00-00'). 'jumlahAktif' above 1 means the stay is stuck in two rooms.",
  parameters: Schema.Struct({ noRawat: NoRawat }),
  output: Schema.Struct({
    noRawat: Str,
    kamar: Schema.Array(Schema.Struct({ ...KamarInapRow.fields, aktif: Schema.Boolean })),
    jumlahAktif: Schema.Number,
  }),
  handler: Effect.fn("riwayatKamar")(function* (params) {
    const read = yield* KhanzaRead;
    const noRawat = params.noRawat.trim();
    const rows = yield* read.query(
      (sql) => sql`
        SELECT ki.kd_kamar, k.kd_bangsal, b.nm_bangsal, k.kelas, ki.trf_kamar,
               ki.tgl_masuk, ki.jam_masuk, ki.tgl_keluar, ki.jam_keluar, ki.lama, ki.ttl_biaya,
               ki.stts_pulang, ki.diagnosa_awal
        FROM kamar_inap ki
        LEFT JOIN kamar k ON k.kd_kamar = ki.kd_kamar
        LEFT JOIN bangsal b ON b.kd_bangsal = k.kd_bangsal
        WHERE ki.no_rawat = ${noRawat}
        ORDER BY ki.tgl_masuk, ki.jam_masuk`,
    );
    const kamar = (yield* decodeRows("riwayatKamar", KamarInapRow)(rows)).map((row) => ({
      ...row,
      aktif: row.stts_pulang === ACTIVE_STAY,
    }));
    return { noRawat, kamar, jumlahAktif: kamar.filter((k) => k.aktif).length };
  }),
});

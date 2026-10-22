import { Effect, Schema } from "effect";
import { ToolError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { containsWords, NullableStr, Str } from "./common.ts";

const MAX_RESULTS = 20;

/** Identity fields only. NIK, phone and address are never selected. */
export const PasienRow = Schema.Struct({
  no_rkm_medis: Str,
  nm_pasien: NullableStr,
  jk: NullableStr,
  tgl_lahir: NullableStr,
  umur: NullableStr,
  kd_pj: NullableStr,
  png_jawab: NullableStr,
  tgl_daftar: NullableStr,
});

export const cariPasien = defineTool({
  name: "cariPasien",
  kind: "read",
  description:
    "Find a patient by medical record number (noRkmMedis, exact) or by name (nama, all words must appear). " +
    "Returns basic identity: RM, name, sex, birth date, age, payer. Never returns NIK, phone or address. " +
    `At most ${MAX_RESULTS} patients; 'lebihBanyak' is true when there were more.`,
  parameters: Schema.Struct({
    noRkmMedis: Schema.optionalKey(Str.annotate({ description: "Exact medical record number (no_rkm_medis)." })),
    nama: Schema.optionalKey(
      Str.check(Schema.isMinLength(2)).annotate({ description: "Part of the patient's name, e.g. 'budi santoso'." }),
    ),
  }),
  output: Schema.Struct({ pasien: Schema.Array(PasienRow), lebihBanyak: Schema.Boolean }),
  handler: Effect.fn("cariPasien")(function* (params) {
    const read = yield* KhanzaRead;
    const noRkmMedis = params.noRkmMedis?.trim();
    const nama = params.nama?.trim();
    if (!noRkmMedis && !nama) {
      return yield* new ToolError({ tool: "cariPasien", message: "Isi salah satu: noRkmMedis atau nama." });
    }
    const rows = yield* read.query(
      (sql) => sql`
        SELECT p.no_rkm_medis, p.nm_pasien, p.jk, p.tgl_lahir, p.umur, p.kd_pj, pj.png_jawab, p.tgl_daftar
        FROM pasien p
        LEFT JOIN penjab pj ON pj.kd_pj = p.kd_pj
        WHERE ${noRkmMedis ? sql`p.no_rkm_medis = ${noRkmMedis}` : sql`p.nm_pasien LIKE ${containsWords(nama ?? "")}`}
        ORDER BY p.nm_pasien, p.no_rkm_medis
        LIMIT ${sql.literal(String(MAX_RESULTS + 1))}`,
    );
    const pasien = yield* decodeRows("cariPasien", PasienRow)(rows);
    return { pasien: pasien.slice(0, MAX_RESULTS), lebihBanyak: pasien.length > MAX_RESULTS };
  }),
});

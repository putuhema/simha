import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { NullableStr, Str } from "./common.ts";

const SuratKontrolRow = Schema.Struct({
  no_surat: Str,
  no_sep: NullableStr,
  tgl_surat: Str,
  tgl_rencana: NullableStr,
  kd_dokter_bpjs: NullableStr,
  nm_dokter_bpjs: NullableStr,
  kd_poli_bpjs: NullableStr,
  nm_poli_bpjs: NullableStr,
});

export const suratKontrol = defineTool({
  name: "suratKontrol",
  kind: "read",
  description:
    "BPJS control letters (bridging_surat_kontrol_bpjs) made from one SEP, oldest first: letter number, " +
    "letter date, planned control date (tgl_rencana), BPJS doctor and clinic codes. Use dataSep first to " +
    "find the SEP number of a visit.",
  parameters: Schema.Struct({
    noSep: Str.check(Schema.isNonEmpty(), Schema.isMaxLength(40)).annotate({
      description: 'SEP number (no_sep), e.g. "0001R0011026V000001".',
    }),
  }),
  output: Schema.Struct({ noSep: Str, suratKontrol: Schema.Array(SuratKontrolRow) }),
  handler: Effect.fn("suratKontrol")(function* (params) {
    const read = yield* KhanzaRead;
    const noSep = params.noSep.trim();
    const rows = yield* read.query(
      (sql) => sql`
        SELECT no_surat, no_sep, tgl_surat, tgl_rencana, kd_dokter_bpjs, nm_dokter_bpjs, kd_poli_bpjs, nm_poli_bpjs
        FROM bridging_surat_kontrol_bpjs
        WHERE no_sep = ${noSep}
        ORDER BY tgl_surat, no_surat`,
    );
    return { noSep, suratKontrol: yield* decodeRows("suratKontrol", SuratKontrolRow)(rows) };
  }),
});

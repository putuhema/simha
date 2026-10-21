import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { NoRawat, NullableStr, Str } from "./common.ts";

/**
 * SEP fields needed to diagnose bridging problems. Left out on purpose:
 * nama_pasien, tanggal_lahir, no_kartu, notelep and the accident-location
 * fields (kdprop ... nmkec, keterangankkl).
 */
const SepRow = Schema.Struct({
  no_sep: Str,
  no_rawat: NullableStr,
  tglsep: NullableStr,
  jnspelayanan: NullableStr,
  klsrawat: NullableStr,
  kdpolitujuan: NullableStr,
  nmpolitujuan: NullableStr,
  diagawal: NullableStr,
  nmdiagnosaawal: NullableStr,
  no_rujukan: NullableStr,
  tglrujukan: NullableStr,
  asal_rujukan: NullableStr,
  kdppkrujukan: NullableStr,
  nmppkrujukan: NullableStr,
  tglpulang: NullableStr,
  noskdp: NullableStr,
  kddpjp: NullableStr,
  nmdpdjp: NullableStr,
  kddpjplayanan: NullableStr,
  nmdpjplayanan: NullableStr,
  tujuankunjungan: NullableStr,
  flagprosedur: NullableStr,
  penunjang: NullableStr,
  asesmenpelayanan: NullableStr,
  peserta: NullableStr,
  user: NullableStr,
});

export const dataSep = defineTool({
  name: "dataSep",
  kind: "read",
  description:
    "BPJS SEP rows (bridging_sep) of one visit, oldest first: SEP number and date, service type " +
    "(jnspelayanan '1' = rawat inap, '2' = rawat jalan), class, target clinic, initial diagnosis, referral, " +
    "discharge date (tglpulang), SKDP/control letter number (noskdp), DPJP, visit purpose and the operator " +
    "(user). Patient name, card number and phone are not returned.",
  parameters: Schema.Struct({ noRawat: NoRawat }),
  output: Schema.Struct({ noRawat: Str, sep: Schema.Array(SepRow) }),
  handler: Effect.fn("dataSep")(function* (params) {
    const read = yield* KhanzaRead;
    const noRawat = params.noRawat.trim();
    const rows = yield* read.query(
      (sql) => sql`
        SELECT no_sep, no_rawat, tglsep, jnspelayanan, klsrawat, kdpolitujuan, nmpolitujuan,
               diagawal, nmdiagnosaawal, no_rujukan, tglrujukan, asal_rujukan, kdppkrujukan, nmppkrujukan,
               tglpulang, noskdp, kddpjp, nmdpdjp, kddpjplayanan, nmdpjplayanan, tujuankunjungan,
               flagprosedur, penunjang, asesmenpelayanan, peserta, user
        FROM bridging_sep
        WHERE no_rawat = ${noRawat}
        ORDER BY tglsep, no_sep`,
    );
    return { noRawat, sep: yield* decodeRows("dataSep", SepRow)(rows) };
  }),
});

import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { NoRawat, NullableStr, Str } from "./common.ts";

const BillingRow = Schema.Struct({
  no_rawat: Str,
  status_lanjut: Str,
  stts: NullableStr,
  status_bayar: Str,
  ada_nota_jalan: Schema.Number,
  ada_nota_inap: Schema.Number,
  nota_jalan_no: NullableStr,
  nota_jalan_tanggal: NullableStr,
  nota_jalan_jam: NullableStr,
  nota_inap_no: NullableStr,
  nota_inap_tanggal: NullableStr,
  nota_inap_jam: NullableStr,
});

const Nota = Schema.NullOr(Schema.Struct({ no_nota: NullableStr, tanggal: NullableStr, jam: NullableStr }));

export const statusBilling = defineTool({
  name: "statusBilling",
  kind: "read",
  description:
    "Billing state of one visit: reg_periksa.status_bayar and stts, plus the outpatient (nota_jalan) and " +
    "inpatient (nota_inap) bill if one was made. 'notaSudahDibuat' is true when the bill matching the " +
    "visit type (Ralan -> nota_jalan, Ranap -> nota_inap) exists; Khanza usually blocks changes to the " +
    "visit after that. 'ditemukan' is false when the visit number does not exist.",
  parameters: Schema.Struct({ noRawat: NoRawat }),
  output: Schema.Struct({
    noRawat: Str,
    ditemukan: Schema.Boolean,
    status_lanjut: NullableStr,
    stts: NullableStr,
    status_bayar: NullableStr,
    notaJalan: Nota,
    notaInap: Nota,
    notaSudahDibuat: Schema.Boolean,
  }),
  handler: Effect.fn("statusBilling")(function* (params) {
    const read = yield* KhanzaRead;
    const noRawat = params.noRawat.trim();
    const rows = yield* read.query(
      (sql) => sql`
        SELECT r.no_rawat, r.status_lanjut, r.stts, r.status_bayar,
               (nj.no_rawat IS NOT NULL) AS ada_nota_jalan, (ni.no_rawat IS NOT NULL) AS ada_nota_inap,
               nj.no_nota AS nota_jalan_no, nj.tanggal AS nota_jalan_tanggal, nj.jam AS nota_jalan_jam,
               ni.no_nota AS nota_inap_no, ni.tanggal AS nota_inap_tanggal, ni.jam AS nota_inap_jam
        FROM reg_periksa r
        LEFT JOIN nota_jalan nj ON nj.no_rawat = r.no_rawat
        LEFT JOIN nota_inap ni ON ni.no_rawat = r.no_rawat
        WHERE r.no_rawat = ${noRawat}`,
    );
    const [row] = yield* decodeRows("statusBilling", BillingRow)(rows);
    if (row === undefined) {
      return {
        noRawat,
        ditemukan: false,
        status_lanjut: null,
        stts: null,
        status_bayar: null,
        notaJalan: null,
        notaInap: null,
        notaSudahDibuat: false,
      };
    }
    const notaJalan =
      row.ada_nota_jalan === 1
        ? { no_nota: row.nota_jalan_no, tanggal: row.nota_jalan_tanggal, jam: row.nota_jalan_jam }
        : null;
    const notaInap =
      row.ada_nota_inap === 1
        ? { no_nota: row.nota_inap_no, tanggal: row.nota_inap_tanggal, jam: row.nota_inap_jam }
        : null;
    return {
      noRawat,
      ditemukan: true,
      status_lanjut: row.status_lanjut,
      stts: row.stts,
      status_bayar: row.status_bayar,
      notaJalan,
      notaInap,
      notaSudahDibuat: row.status_lanjut === "Ranap" ? notaInap !== null : notaJalan !== null,
    };
  }),
});

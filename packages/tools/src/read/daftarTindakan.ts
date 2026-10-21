import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { NoRawat, NullableNum, NullableStr, Str } from "./common.ts";

const TindakanRow = Schema.Struct({
  sumber: Schema.Literals(["rawat_jl_dr", "rawat_jl_pr", "rawat_jl_drpr", "rawat_inap_dr", "rawat_inap_pr", "rawat_inap_drpr"]),
  kd_jenis_prw: Str,
  nm_perawatan: NullableStr,
  kd_dokter: NullableStr,
  nip: NullableStr,
  tgl_perawatan: Str,
  jam_rawat: Str,
  biaya_rawat: NullableNum,
  stts_bayar: NullableStr,
});

export const daftarTindakan = defineTool({
  name: "daftarTindakan",
  kind: "read",
  description:
    "All tindakan (procedures) entered for one visit, oldest first, from the six Khanza tables: " +
    "rawat_jl_dr / rawat_jl_pr / rawat_jl_drpr (outpatient: by doctor, nurse, doctor+nurse) and " +
    "rawat_inap_dr / rawat_inap_pr / rawat_inap_drpr (inpatient). 'sumber' is the table the row is in. " +
    "stts_bayar exists only for outpatient rows.",
  parameters: Schema.Struct({ noRawat: NoRawat }),
  output: Schema.Struct({ noRawat: Str, tindakan: Schema.Array(TindakanRow) }),
  handler: Effect.fn("daftarTindakan")(function* (params) {
    const read = yield* KhanzaRead;
    const noRawat = params.noRawat.trim();
    const rows = yield* read.query(
      (sql) => sql`
        SELECT 'rawat_jl_dr' AS sumber, t.kd_jenis_prw, j.nm_perawatan, t.kd_dokter, NULL AS nip,
               t.tgl_perawatan, t.jam_rawat, t.biaya_rawat, t.stts_bayar
          FROM rawat_jl_dr t LEFT JOIN jns_perawatan j ON j.kd_jenis_prw = t.kd_jenis_prw
          WHERE t.no_rawat = ${noRawat}
        UNION ALL
        SELECT 'rawat_jl_pr', t.kd_jenis_prw, j.nm_perawatan, NULL, t.nip,
               t.tgl_perawatan, t.jam_rawat, t.biaya_rawat, t.stts_bayar
          FROM rawat_jl_pr t LEFT JOIN jns_perawatan j ON j.kd_jenis_prw = t.kd_jenis_prw
          WHERE t.no_rawat = ${noRawat}
        UNION ALL
        SELECT 'rawat_jl_drpr', t.kd_jenis_prw, j.nm_perawatan, t.kd_dokter, t.nip,
               t.tgl_perawatan, t.jam_rawat, t.biaya_rawat, t.stts_bayar
          FROM rawat_jl_drpr t LEFT JOIN jns_perawatan j ON j.kd_jenis_prw = t.kd_jenis_prw
          WHERE t.no_rawat = ${noRawat}
        UNION ALL
        SELECT 'rawat_inap_dr', t.kd_jenis_prw, j.nm_perawatan, t.kd_dokter, NULL,
               t.tgl_perawatan, t.jam_rawat, t.biaya_rawat, NULL
          FROM rawat_inap_dr t LEFT JOIN jns_perawatan_inap j ON j.kd_jenis_prw = t.kd_jenis_prw
          WHERE t.no_rawat = ${noRawat}
        UNION ALL
        SELECT 'rawat_inap_pr', t.kd_jenis_prw, j.nm_perawatan, NULL, t.nip,
               t.tgl_perawatan, t.jam_rawat, t.biaya_rawat, NULL
          FROM rawat_inap_pr t LEFT JOIN jns_perawatan_inap j ON j.kd_jenis_prw = t.kd_jenis_prw
          WHERE t.no_rawat = ${noRawat}
        UNION ALL
        SELECT 'rawat_inap_drpr', t.kd_jenis_prw, j.nm_perawatan, t.kd_dokter, t.nip,
               t.tgl_perawatan, t.jam_rawat, t.biaya_rawat, NULL
          FROM rawat_inap_drpr t LEFT JOIN jns_perawatan_inap j ON j.kd_jenis_prw = t.kd_jenis_prw
          WHERE t.no_rawat = ${noRawat}
        ORDER BY tgl_perawatan, jam_rawat`,
    );
    return { noRawat, tindakan: yield* decodeRows("daftarTindakan", TindakanRow)(rows) };
  }),
});

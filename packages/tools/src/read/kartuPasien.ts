/**
 * Patient card: identity, the latest visits and the DPJP of the latest
 * visit, in one call. Used by the ticket view's patient column and by the AI
 * for "ringkas kunjungan pasien ini". Never NIK, phone or address.
 */
import { Effect, Schema } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { decodeRows, defineTool } from "../tool.ts";
import { cariPasien, PasienRow } from "./cariPasien.ts";
import { NoRkmMedis, NullableStr, Str } from "./common.ts";
import { KunjunganRow, kunjunganAktif } from "./kunjunganAktif.ts";

const DpjpRow = Schema.Struct({ kd_dokter: Str, nm_dokter: NullableStr });

export const kartuPasien = defineTool({
  name: "kartuPasien",
  kind: "read",
  description:
    "Patient summary for one RM number: identity (no NIK/phone/address), the 8 latest visits with status, " +
    "clinic, doctor, payer and current room, and the DPJP of the latest visit. Use it to summarise a patient " +
    "or a visit.",
  parameters: Schema.Struct({ noRkmMedis: NoRkmMedis }),
  output: Schema.Struct({
    pasien: Schema.NullOr(PasienRow),
    kunjungan: Schema.Array(KunjunganRow),
    dpjp: Schema.Array(DpjpRow),
  }),
  handler: Effect.fn("kartuPasien")(function* ({ noRkmMedis }) {
    const read = yield* KhanzaRead;
    const { pasien } = yield* cariPasien.handler({ noRkmMedis });
    const { kunjungan } = yield* kunjunganAktif.handler({ noRkmMedis, batas: 8 });
    const latest = kunjungan[0];
    const dpjp = latest
      ? yield* read
          .query(
            (sql) => sql`
              SELECT p.kd_dokter, d.nm_dokter FROM dpjp_ranap p LEFT JOIN dokter d ON d.kd_dokter = p.kd_dokter
              WHERE p.no_rawat = ${latest.no_rawat}`,
          )
          .pipe(Effect.flatMap(decodeRows("kartuPasien", DpjpRow)))
      : [];
    return { pasien: pasien[0] ?? null, kunjungan, dpjp };
  }),
});

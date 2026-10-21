import { cariPasien } from "./cariPasien.ts";
import { daftarTindakan } from "./daftarTindakan.ts";
import { dataSep } from "./dataSep.ts";
import { kunjunganAktif } from "./kunjunganAktif.ts";
import { riwayatKamar } from "./riwayatKamar.ts";
import { statusBilling } from "./statusBilling.ts";
import { statusKamar } from "./statusKamar.ts";
import { suratKontrol } from "./suratKontrol.ts";

export { cariPasien, daftarTindakan, dataSep, kunjunganAktif, riwayatKamar, statusBilling, statusKamar, suratKontrol };

/** The read tools, in the order the AI model sees them. */
export const readTools = [
  cariPasien,
  kunjunganAktif,
  riwayatKamar,
  statusKamar,
  daftarTindakan,
  statusBilling,
  dataSep,
  suratKontrol,
] as const;

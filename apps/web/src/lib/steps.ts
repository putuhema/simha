/**
 * Turns tool calls into the "Yang dicek AI" list: a label, a one-line
 * summary of the result, and a mark (✓ fine, ! found a problem, ✕ failed).
 */

export type StepMark = "ok" | "warn" | "error" | "running";

export interface StepView {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly error: string | null;
  readonly durationMs: number | null;
  readonly running: boolean;
}

const LABELS: Readonly<Record<string, string>> = {
  cariPasien: "Cari pasien",
  kunjunganAktif: "Kunjungan pasien",
  riwayatKamar: "Riwayat kamar",
  statusKamar: "Status kamar",
  daftarTindakan: "Daftar tindakan",
  statusBilling: "Status billing",
  dataSep: "Data SEP BPJS",
  suratKontrol: "Surat kontrol BPJS",
  kartuPasien: "Kartu pasien",
  diagnosaPindahKamar: "Diagnosa pindah kamar",
  diagnosaTindakan: "Diagnosa tindakan",
  usulkanPerbaikan: "Usulan perbaikan",
  lihatSkema: "Lihat skema",
  jalankanQueryBaca: "Jalankan query",
  tampilkan: "Tampilkan hasil",
};

export const stepLabel = (name: string) => LABELS[name] ?? name;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/** The input values worth showing next to the label, e.g. "RM 000001". */
export const stepTarget = (input: unknown): string => {
  const i = record(input);
  const parts = [
    i["noRkmMedis"] && `RM ${String(i["noRkmMedis"])}`,
    i["nama"] && `"${String(i["nama"])}"`,
    i["noRawat"] && String(i["noRawat"]),
    i["kdKamar"] && String(i["kdKamar"]),
    i["kdKamarTujuan"] && `→ ${String(i["kdKamarTujuan"])}`,
    i["namaBangsal"] && String(i["namaBangsal"]),
    i["noSep"] && String(i["noSep"]),
    i["kataKunci"] && `"${String(i["kataKunci"])}"`,
    i["judul"] && String(i["judul"]),
  ].filter(Boolean);
  return parts.join(" · ");
};

export const stepMark = (step: StepView): StepMark => {
  if (step.running) return "running";
  if (step.error !== null) return "error";
  const o = record(step.output);
  if (typeof o["jumlahMasalah"] === "number" && o["jumlahMasalah"] > 0) return "warn";
  if (Array.isArray(o["kamar"]) && typeof o["jumlahAktif"] === "number" && o["jumlahAktif"] > 1) return "warn";
  if (step.name === "statusKamar" && Array.isArray(o["kamar"]) && o["kamar"].some((k) => record(k)["catatan"])) return "warn";
  if (step.name === "usulkanPerbaikan") return "warn";
  return "ok";
};

/** One line about the result, in Indonesian. */
export const stepSummary = (step: StepView): string => {
  if (step.running) return "Sedang berjalan…";
  if (step.error !== null) return step.error;
  const o = record(step.output);
  switch (step.name) {
    case "cariPasien":
      return `${count(o["pasien"])} pasien ditemukan`;
    case "kunjunganAktif":
      return `${count(o["kunjungan"])} kunjungan`;
    case "riwayatKamar":
      return `${count(o["kamar"])} baris kamar, ${String(o["jumlahAktif"] ?? 0)} aktif`;
    case "statusKamar": {
      const rooms = Array.isArray(o["kamar"]) ? o["kamar"].map(record) : [];
      const free = rooms.filter((k) => k["bisaDipakai"]).length;
      const notes = rooms.filter((k) => k["catatan"]).length;
      return `${rooms.length} kamar, ${free} bisa dipakai${notes ? `, ${notes} status tidak cocok` : ""}`;
    }
    case "statusBilling":
      return o["ditemukan"] ? (o["notaSudahDibuat"] ? "Nota sudah dibuat" : `Belum ada nota · ${String(o["status_bayar"] ?? "")}`) : "Kunjungan tidak ditemukan";
    case "dataSep":
      return `${count(o["sep"])} SEP`;
    case "suratKontrol":
      return `${count(o["suratKontrol"])} surat kontrol`;
    case "daftarTindakan":
      return `${count(o["tindakan"])} tindakan`;
    case "diagnosaPindahKamar":
    case "diagnosaTindakan": {
      const problems = Number(o["jumlahMasalah"] ?? 0);
      return problems > 0 ? `${problems} masalah ditemukan` : "Tidak ada masalah";
    }
    case "usulkanPerbaikan":
      return `Menunggu persetujuan · akan mengubah ${String(o["barisTerdampak"] ?? "?")} baris`;
    case "jalankanQueryBaca":
      return `${String(o["jumlahBaris"] ?? 0)} baris${o["terpotong"] ? " (dipotong di 500)" : ""}`;
    case "tampilkan": {
      const block = record(o["block"]);
      return `Ditampilkan: ${String(block["judul"] ?? "")}`;
    }
    case "lihatSkema":
      return `${count(o["dariDokumen"]) + count(o["dariDatabase"])} tabel cocok`;
    case "kartuPasien":
      return o["pasien"] ? `${count(o["kunjungan"])} kunjungan` : "Pasien tidak ditemukan";
    default: {
      const firstArray = Object.values(o).find(Array.isArray);
      return firstArray ? `${firstArray.length} baris` : "Selesai";
    }
  }
};

/** Findings of a diagnose tool, for the expanded view. */
export const findingsOf = (output: unknown): ReadonlyArray<{ cek: string; hasil: string; keterangan: string }> => {
  const temuan = record(output)["temuan"];
  return Array.isArray(temuan) ? (temuan as Array<{ cek: string; hasil: string; keterangan: string }>) : [];
};

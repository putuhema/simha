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
  /** The tool's JSON arguments while the AI is still writing them; null once the call is complete. */
  readonly draft: string | null;
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
  dokumenPasien: "Buat dokumen",
  berkasDigital: "Berkas digital",
  buatDraftResume: "Siapkan draf resume",
  isiDraft: "Isi draf resume",
  hasilRadiologi: "Hasil radiologi",
  diagnosaPindahKamar: "Diagnosa pindah kamar",
  diagnosaTindakan: "Diagnosa tindakan",
  usulkanPerbaikan: "Usulan perbaikan",
  lihatSkema: "Lihat skema",
  cariAplikasiKhanza: "Cari menu aplikasi",
  catatPengetahuan: "Catat pengetahuan",
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
  if (step.draft !== null) return step.name === "jalankanQueryBaca" ? "AI sedang menulis query…" : "AI sedang menyiapkan…";
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
    case "cariAplikasiKhanza": {
      const menus = count(o["menu"]);
      const forms = count(o["form"]);
      return menus > 0 ? `${menus} menu, ${forms} form` : `${forms} form cocok`;
    }
    case "catatPengetahuan":
      return String(o["pesan"] ?? "Catatan disimpan");
    case "kartuPasien":
      return o["pasien"] ? `${count(o["kunjungan"])} kunjungan` : "Pasien tidak ditemukan";
    default: {
      const firstArray = Object.values(o).find(Array.isArray);
      return firstArray ? `${firstArray.length} baris` : "Selesai";
    }
  }
};

/** Keys whose (partial) value is worth showing while a tool call is being written, best first. */
const DRAFT_KEYS = ["sql", "judul", "kataKunci", "nama", "noRkmMedis", "noRawat", "alasan"];

/**
 * The most useful string in half-written JSON arguments, e.g. the SQL typed
 * so far from `{"sql":"SELECT p.nm_poli, COUNT(` .
 */
export const draftPreview = (draft: string): string => {
  for (const key of DRAFT_KEYS) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(draft);
    if (match?.[1] === undefined) continue;
    const raw = match[1].replace(/\\(u[0-9a-fA-F]{0,3})?$/, ""); // drop an escape cut in half
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      return raw;
    }
  }
  return "";
};

/** Findings of a diagnose tool, for the expanded view. */
export const findingsOf = (output: unknown): ReadonlyArray<{ cek: string; hasil: string; keterangan: string }> => {
  const temuan = record(output)["temuan"];
  return Array.isArray(temuan) ? (temuan as Array<{ cek: string; hasil: string; keterangan: string }>) : [];
};

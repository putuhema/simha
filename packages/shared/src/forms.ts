/**
 * Khanza forms the harness can draft and fill (through the desktop app's
 * Khanza bridge). Each field is a column of the Khanza table, with the label,
 * length and choices of Khanza's own form, so a draft that passes these
 * checks is also accepted by Khanza's Simpan.
 *
 * No Effect imports here: the desktop app's main process uses this too.
 */

export type FormFieldType = "text" | "textarea" | "choice" | "datetime";

export interface FormField {
  /** Column name in Khanza (also the key in a draft). */
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly type: FormFieldType;
  /** Max characters (varchar); undefined for text columns. */
  readonly max?: number;
  readonly options?: ReadonlyArray<string>;
  /** Khanza refuses Simpan without it. */
  readonly required?: boolean;
}

export type FormKind = "resume_ranap";

/** resume_pasien_ranap, in the order of Khanza's RMDataResumePasienRanap form. */
const RESUME_RANAP: ReadonlyArray<FormField> = [
  { key: "diagnosa_awal", label: "Diagnosa awal masuk", group: "Masuk", type: "text", max: 100 },
  { key: "alasan", label: "Alasan masuk dirawat", group: "Masuk", type: "text", max: 100 },
  { key: "keluhan_utama", label: "Keluhan utama riwayat penyakit", group: "Anamnesis & pemeriksaan", type: "textarea", required: true },
  { key: "pemeriksaan_fisik", label: "Pemeriksaan fisik", group: "Anamnesis & pemeriksaan", type: "textarea" },
  { key: "jalannya_penyakit", label: "Jalannya penyakit selama perawatan", group: "Anamnesis & pemeriksaan", type: "textarea", required: true },
  { key: "pemeriksaan_penunjang", label: "Pemeriksaan penunjang (radiologi)", group: "Penunjang & terapi", type: "textarea" },
  { key: "hasil_laborat", label: "Hasil laboratorium", group: "Penunjang & terapi", type: "textarea" },
  { key: "tindakan_dan_operasi", label: "Tindakan / operasi selama di RS", group: "Penunjang & terapi", type: "textarea" },
  { key: "obat_di_rs", label: "Obat selama di RS", group: "Penunjang & terapi", type: "textarea" },
  { key: "diagnosa_utama", label: "Diagnosa utama", group: "Diagnosa (ICD-10)", type: "text", max: 80, required: true },
  { key: "kd_diagnosa_utama", label: "Kode diagnosa utama", group: "Diagnosa (ICD-10)", type: "text", max: 10 },
  { key: "diagnosa_sekunder", label: "Diagnosa sekunder 1", group: "Diagnosa (ICD-10)", type: "text", max: 80 },
  { key: "kd_diagnosa_sekunder", label: "Kode sekunder 1", group: "Diagnosa (ICD-10)", type: "text", max: 10 },
  { key: "diagnosa_sekunder2", label: "Diagnosa sekunder 2", group: "Diagnosa (ICD-10)", type: "text", max: 80 },
  { key: "kd_diagnosa_sekunder2", label: "Kode sekunder 2", group: "Diagnosa (ICD-10)", type: "text", max: 10 },
  { key: "diagnosa_sekunder3", label: "Diagnosa sekunder 3", group: "Diagnosa (ICD-10)", type: "text", max: 80 },
  { key: "kd_diagnosa_sekunder3", label: "Kode sekunder 3", group: "Diagnosa (ICD-10)", type: "text", max: 10 },
  { key: "diagnosa_sekunder4", label: "Diagnosa sekunder 4", group: "Diagnosa (ICD-10)", type: "text", max: 80 },
  { key: "kd_diagnosa_sekunder4", label: "Kode sekunder 4", group: "Diagnosa (ICD-10)", type: "text", max: 10 },
  { key: "prosedur_utama", label: "Prosedur utama", group: "Prosedur (ICD-9-CM)", type: "text", max: 80 },
  { key: "kd_prosedur_utama", label: "Kode prosedur utama", group: "Prosedur (ICD-9-CM)", type: "text", max: 8 },
  { key: "prosedur_sekunder", label: "Prosedur sekunder 1", group: "Prosedur (ICD-9-CM)", type: "text", max: 80 },
  { key: "kd_prosedur_sekunder", label: "Kode prosedur 1", group: "Prosedur (ICD-9-CM)", type: "text", max: 8 },
  { key: "prosedur_sekunder2", label: "Prosedur sekunder 2", group: "Prosedur (ICD-9-CM)", type: "text", max: 80 },
  { key: "kd_prosedur_sekunder2", label: "Kode prosedur 2", group: "Prosedur (ICD-9-CM)", type: "text", max: 8 },
  { key: "prosedur_sekunder3", label: "Prosedur sekunder 3", group: "Prosedur (ICD-9-CM)", type: "text", max: 80 },
  { key: "kd_prosedur_sekunder3", label: "Kode prosedur 3", group: "Prosedur (ICD-9-CM)", type: "text", max: 8 },
  { key: "alergi", label: "Alergi / reaksi obat", group: "Pulang", type: "text", max: 100 },
  { key: "diet", label: "Diet", group: "Pulang", type: "textarea" },
  { key: "lab_belum", label: "Hasil lab yang belum selesai (pending)", group: "Pulang", type: "textarea" },
  { key: "edukasi", label: "Instruksi / anjuran dan edukasi", group: "Pulang", type: "textarea" },
  {
    key: "cara_keluar",
    label: "Cara keluar",
    group: "Pulang",
    type: "choice",
    options: ["Atas Izin Dokter", "Pindah RS", "Pulang Atas Permintaan Sendiri", "Lainnya"],
  },
  { key: "ket_keluar", label: "Keterangan cara keluar", group: "Pulang", type: "text", max: 50 },
  { key: "keadaan", label: "Keadaan pulang", group: "Pulang", type: "choice", options: ["Membaik", "Sembuh", "Keadaan Khusus", "Meninggal"] },
  { key: "ket_keadaan", label: "Keterangan keadaan pulang", group: "Pulang", type: "text", max: 50 },
  {
    key: "dilanjutkan",
    label: "Dilanjutkan",
    group: "Pulang",
    type: "choice",
    options: ["Kembali Ke RS", "RS Lain", "Dokter Luar", "Puskesmes", "Lainnya"],
  },
  { key: "ket_dilanjutkan", label: "Keterangan dilanjutkan", group: "Pulang", type: "text", max: 50 },
  { key: "kontrol", label: "Tanggal kontrol (YYYY-MM-DD HH:MM)", group: "Pulang", type: "datetime" },
  { key: "obat_pulang", label: "Obat pulang", group: "Pulang", type: "textarea" },
];

export const FORM_FIELDS: Readonly<Record<FormKind, ReadonlyArray<FormField>>> = { resume_ranap: RESUME_RANAP };

export const FORM_TITLES: Readonly<Record<FormKind, string>> = { resume_ranap: "Resume medis rawat inap" };

/** Longest value for any field (text columns), so a request stays reasonable. */
export const MAX_FIELD_TEXT = 4000;

const DATETIME = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

/** Why `value` cannot go into `field`, or null when it can. Empty means "leave empty". */
export const fieldProblem = (field: FormField, value: string): string | null => {
  if (value === "") return null;
  if (value.length > (field.max ?? MAX_FIELD_TEXT)) return `${field.label}: maksimal ${field.max ?? MAX_FIELD_TEXT} karakter (sekarang ${value.length}).`;
  if (field.type === "choice" && !field.options?.includes(value)) return `${field.label}: pilih salah satu: ${field.options?.join(", ")}.`;
  if (field.type === "datetime" && !DATETIME.test(value)) return `${field.label}: format YYYY-MM-DD HH:MM.`;
  return null;
};

/** Problems of a whole set of values (unknown keys included). */
export const formProblems = (form: FormKind, values: Readonly<Record<string, string>>): ReadonlyArray<string> => {
  const fields = new Map(FORM_FIELDS[form].map((f) => [f.key, f]));
  return Object.entries(values).flatMap(([key, value]) => {
    const field = fields.get(key);
    if (!field) return [`Field ${key} tidak ada di form ${FORM_TITLES[form]}.`];
    if (typeof value !== "string") return [`${field.label}: harus teks.`];
    const problem = fieldProblem(field, value);
    return problem ? [problem] : [];
  });
};

/**
 * Draft of Khanza's "Resume Pasien Ranap" for one inpatient visit.
 *
 * The server fills what Khanza already knows (diagnoses, procedures, first
 * CPPT, lab, radiology, tindakan, obat, discharge status), or takes the
 * resume already written in Khanza. The AI then asks the user for the rest
 * and stores the answers with `isiDraft`; the user can edit everything in the
 * draft card. The desktop app puts the draft into Khanza's own form; the user
 * saves it there. Nothing here writes to Khanza.
 */
import { FORM_FIELDS, MAX_FIELD_TEXT, type FieldSource, type FormDraft } from "@simha/shared";
import { Effect } from "effect";
import { ToolError } from "../errors.ts";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { cpptOf, detailsOf, identityOf, labOf, radiologyOf, visitOf } from "../documents/data.ts";

type Row = Record<string, unknown>;

const FIELDS = FORM_FIELDS.resume_ranap;
const MAX = new Map(FIELDS.map((f) => [f.key, f.max ?? MAX_FIELD_TEXT]));

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return s.trim() === "-" ? "" : s.trim();
};

/** Cuts a value to what the Khanza column holds. */
const fit = (key: string, value: string): string => {
  const max = MAX.get(key) ?? MAX_FIELD_TEXT;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
};

/** kamar_inap.stts_pulang -> Khanza's "cara keluar" and "keadaan pulang". */
export const dischargeFrom = (status: string): { cara_keluar?: string; keadaan?: string } => {
  switch (status) {
    case "Sehat":
    case "Sembuh":
      return { cara_keluar: "Atas Izin Dokter", keadaan: "Sembuh" };
    case "Membaik":
      return { cara_keluar: "Atas Izin Dokter", keadaan: "Membaik" };
    case "Atas Persetujuan Dokter":
      return { cara_keluar: "Atas Izin Dokter" };
    case "Rujuk":
      return { cara_keluar: "Pindah RS" };
    case "APS":
    case "Atas Permintaan Sendiri":
    case "Pulang Paksa":
      return { cara_keluar: "Pulang Atas Permintaan Sendiri" };
    case "Meninggal":
    case "+":
      return { cara_keluar: "Lainnya", keadaan: "Meninggal" };
    default:
      return {};
  }
};

const dateTime = (value: unknown): string => {
  const s = text(value);
  if (s === "" || s.startsWith("0000")) return "";
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(s);
  return match ? `${match[1]} ${match[2]}` : s.slice(0, 10);
};

const day = (value: string | null) => (value ? value.slice(0, 10) : "");

/** The draft's fields and where each came from, for a visit (or the resume already in Khanza). */
export const buildResumeDraft = (tool: string, noRawat: string) =>
  Effect.gen(function* () {
    const read = yield* KhanzaRead;
    const { visit, noRkmMedis } = yield* visitOf(tool, noRawat);
    if (visit.jenis !== "Rawat inap") {
      return yield* new ToolError({ tool, message: `${noRawat} bukan kunjungan rawat inap; draf resume ranap hanya untuk rawat inap.` });
    }
    const identity = yield* identityOf(tool, noRkmMedis);
    const subjek = `RM ${identity.noRkmMedis} · ${identity.nama ?? ""} · ${noRawat}`;

    const fields: Record<string, string> = {};
    const sources: Record<string, FieldSource> = {};
    const put = (key: string, value: string, source: FieldSource) => {
      if (value === "") return;
      fields[key] = fit(key, value);
      sources[key] = source;
    };

    // A resume already written in Khanza: start from it (filling it later means Khanza's Ganti).
    const [existing] = yield* read.query<Row>((sql) => sql`SELECT * FROM resume_pasien_ranap WHERE no_rawat = ${noRawat}`);
    if (existing) {
      for (const field of FIELDS) {
        put(field.key, field.type === "datetime" ? dateTime(existing[field.key]) : text(existing[field.key]), "khanza");
      }
      return { subjek, existing: true, fields, sources };
    }

    // Admission and discharge.
    const rooms = yield* read.query<Row>(
      (sql) => sql`SELECT diagnosa_awal, stts_pulang FROM kamar_inap WHERE no_rawat = ${noRawat} ORDER BY tgl_masuk, jam_masuk`,
    );
    const [request] = yield* read.query<Row>((sql) => sql`SELECT diagnosa FROM permintaan_ranap WHERE no_rawat = ${noRawat}`);
    put("diagnosa_awal", text(rooms[0]?.["diagnosa_awal"]) || text(request?.["diagnosa"]), "data");
    const discharge = dischargeFrom(text(rooms.at(-1)?.["stts_pulang"]));
    if (discharge.cara_keluar) put("cara_keluar", discharge.cara_keluar, "data");
    if (discharge.keadaan) put("keadaan", discharge.keadaan, "data");

    // Diagnoses (ICD-10) and procedures (ICD-9-CM) by priority, as Khanza's form loads them.
    const diagnoses = yield* read.query<Row>(
      (sql) => sql`
        SELECT dp.kd_penyakit, py.nm_penyakit, dp.prioritas
        FROM diagnosa_pasien dp LEFT JOIN penyakit py ON py.kd_penyakit = dp.kd_penyakit
        WHERE dp.no_rawat = ${noRawat} AND dp.status = 'Ranap' ORDER BY dp.prioritas`,
    );
    const diagnosisKeys = ["diagnosa_utama", "diagnosa_sekunder", "diagnosa_sekunder2", "diagnosa_sekunder3", "diagnosa_sekunder4"];
    for (const d of diagnoses) {
      const key = diagnosisKeys[Number(d["prioritas"]) - 1];
      if (!key) continue;
      put(key, text(d["nm_penyakit"]) || text(d["kd_penyakit"]), "data");
      put(`kd_${key}`, text(d["kd_penyakit"]), "data");
    }
    const procedures = yield* read.query<Row>(
      (sql) => sql`
        SELECT pp.kode, i.deskripsi_panjang, pp.prioritas
        FROM prosedur_pasien pp LEFT JOIN icd9 i ON i.kode = pp.kode
        WHERE pp.no_rawat = ${noRawat} ORDER BY pp.prioritas`,
    );
    const procedureKeys = ["prosedur_utama", "prosedur_sekunder", "prosedur_sekunder2", "prosedur_sekunder3"];
    for (const p of procedures) {
      const key = procedureKeys[Number(p["prioritas"]) - 1];
      if (!key) continue;
      put(key, text(p["deskripsi_panjang"]) || text(p["kode"]), "data");
      put(`kd_${key}`, text(p["kode"]), "data");
    }

    // First CPPT entry (a doctor's, if there is one): complaint and examination. Latest allergy note.
    const entries = yield* cpptOf(noRawat);
    const first = entries.find((e) => e.profesi === "Dokter") ?? entries[0];
    if (first) {
      put("keluhan_utama", text(first.subjektif), "data");
      put("pemeriksaan_fisik", [text(first.tandaVital), text(first.objektif)].filter(Boolean).join("\n"), "data");
    }
    const allergy = entries.toReversed().map((e) => text(e.alergi)).find((a) => a !== "" && !/^tidak ada$/i.test(a));
    if (allergy) put("alergi", allergy, "data");

    // Lab, radiology, tindakan and medicines during the stay.
    const lab = yield* labOf(noRawat);
    put(
      "hasil_laborat",
      lab
        .map((l) => `${day(l.tanggal)} ${text(l.item) || text(l.jenisPemeriksaan)}: ${text(l.nilai)} ${text(l.satuan)}${l.rujukan ? ` (rujukan ${text(l.rujukan)})` : ""}${l.keterangan ? ` ${text(l.keterangan)}` : ""}`.trim())
        .join("\n"),
      "data",
    );
    const radiology = yield* radiologyOf(noRawat);
    put("pemeriksaan_penunjang", radiology.map((r) => `${day(r.tanggal)}: ${text(r.laporanRadiologi)}`).join("\n"), "data");
    const [details] = yield* detailsOf([visit]);
    put("tindakan_dan_operasi", [...new Set(details?.tindakan ?? [])].join(", "), "data");
    put("obat_di_rs", (details?.obat ?? []).map((o) => `${o.nama} (${o.jumlah})`).join(", "), "data");

    return { subjek, existing: false, fields, sources };
  });

/** What the AI needs to know about a draft: what is filled (clinical text is masked for external AI by key) and what is missing. */
export const draftForModel = (draft: FormDraft) => {
  const missing = FIELDS.filter((f) => !draft.fields[f.key]);
  return {
    draftId: draft.id,
    noRawat: draft.noRawat,
    sudahAdaResumeDiKhanza: draft.existing,
    terisi: Object.fromEntries(FIELDS.filter((f) => draft.fields[f.key]).map((f) => [f.key, draft.fields[f.key]])),
    kosongWajib: missing.filter((f) => f.required).map((f) => ({ key: f.key, label: f.label })),
    kosong: missing
      .filter((f) => !f.required && !f.key.startsWith("kd_") && !/sekunder[234]$/.test(f.key))
      .map((f) => ({ key: f.key, label: f.label, ...(f.options ? { pilihan: f.options } : {}) })),
  };
};

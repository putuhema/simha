/**
 * Khanza tables the harness plans to use, with the columns the tools expect.
 *
 * These are the *standard* Khanza names. Our schema is modified, so
 * inspect-schema.ts checks every one of them against the live database and
 * reports anything missing instead of letting later code guess.
 */
export interface ExpectedTable {
  readonly name: string;
  /** Why the harness needs this table (shown in docs/schema.md). */
  readonly purpose: string;
  readonly columns: ReadonlyArray<string>;
  /** True for tables not in the original brief but likely needed. */
  readonly extra?: boolean;
}

export const KHANZA_TABLES: ReadonlyArray<ExpectedTable> = [
  {
    name: "pasien",
    purpose: "Patient identity (cariPasien)",
    columns: ["no_rkm_medis", "nm_pasien", "no_ktp", "jk", "tgl_lahir", "alamat", "no_tlp", "kd_pj", "no_peserta"],
  },
  {
    name: "reg_periksa",
    purpose: "Registrations / visits (kunjunganAktif, counts per poli)",
    columns: [
      "no_rawat",
      "no_reg",
      "tgl_registrasi",
      "jam_reg",
      "kd_dokter",
      "no_rkm_medis",
      "kd_poli",
      "stts",
      "status_lanjut",
      "kd_pj",
      "status_bayar",
    ],
  },
  {
    name: "kamar_inap",
    purpose: "Room history for an inpatient stay (riwayatKamar, diagnosaPindahKamar)",
    columns: ["no_rawat", "kd_kamar", "tgl_masuk", "jam_masuk", "tgl_keluar", "jam_keluar", "lama", "stts_pulang"],
  },
  {
    name: "kamar",
    purpose: "Rooms and whether they are occupied (statusKamar)",
    columns: ["kd_kamar", "kd_bangsal", "kelas", "status"],
  },
  {
    name: "bangsal",
    purpose: "Wards, e.g. Melati / Mawar",
    columns: ["kd_bangsal", "nm_bangsal"],
  },
  {
    name: "rawat_jl_pr",
    purpose: "Outpatient tindakan by nurse (daftarTindakan)",
    columns: ["no_rawat", "kd_jenis_prw", "nip", "tgl_perawatan", "jam_rawat"],
  },
  {
    name: "rawat_inap_pr",
    purpose: "Inpatient tindakan by nurse (daftarTindakan)",
    columns: ["no_rawat", "kd_jenis_prw", "nip", "tgl_perawatan", "jam_rawat"],
  },
  {
    name: "jns_perawatan",
    purpose: "Outpatient tindakan master",
    columns: ["kd_jenis_prw", "nm_perawatan", "kd_poli"],
  },
  {
    name: "jns_perawatan_inap",
    purpose: "Inpatient tindakan master",
    columns: ["kd_jenis_prw", "nm_perawatan", "kd_bangsal"],
  },
  {
    name: "nota_jalan",
    purpose: "Outpatient bill closed? (statusBilling)",
    columns: ["no_rawat", "no_nota", "tanggal"],
  },
  {
    name: "nota_inap",
    purpose: "Inpatient bill closed? (statusBilling)",
    columns: ["no_rawat", "no_nota", "tanggal"],
  },
  {
    name: "bridging_sep",
    purpose: "BPJS SEP (dataSep)",
    columns: ["no_sep", "no_rawat", "tglsep", "no_kartu"],
  },
  {
    name: "bridging_surat_kontrol_bpjs",
    purpose: "BPJS control letters (suratKontrol)",
    columns: ["no_sep", "no_surat", "tgl_rencana", "kd_dokter_bpjs"],
  },
  {
    name: "dokter",
    purpose: "Doctors / DPJP names",
    columns: ["kd_dokter", "nm_dokter"],
  },
  {
    name: "poliklinik",
    purpose: "Clinics, e.g. poli gigi",
    columns: ["kd_poli", "nm_poli"],
  },
  {
    name: "detail_pemberian_obat",
    purpose: "Drugs given to patients (top drugs)",
    columns: ["no_rawat", "kode_brng", "jml", "tgl_perawatan", "jam"],
  },
  {
    name: "databarang",
    purpose: "Drug / item master",
    columns: ["kode_brng", "nama_brng", "kode_sat"],
  },
  {
    name: "penjab",
    purpose: "Payer (BPJS vs umum)",
    columns: ["kd_pj", "png_jawab"],
    extra: true,
  },
  {
    name: "resep_obat",
    purpose: "Prescription header (\"obat paling banyak diresepkan\")",
    columns: ["no_resep", "no_rawat", "tgl_peresepan", "kd_dokter"],
    extra: true,
  },
  {
    name: "resep_dokter",
    purpose: "Prescription lines",
    columns: ["no_resep", "kode_brng", "jml"],
    extra: true,
  },
  {
    name: "dpjp_ranap",
    purpose: "DPJP for inpatients (patient card)",
    columns: ["no_rawat", "kd_dokter"],
    extra: true,
  },
  {
    name: "rawat_jl_dr",
    purpose: "Outpatient tindakan by doctor (daftarTindakan)",
    columns: ["no_rawat", "kd_jenis_prw", "kd_dokter", "tgl_perawatan", "jam_rawat", "biaya_rawat", "stts_bayar"],
    extra: true,
  },
  {
    name: "rawat_jl_drpr",
    purpose: "Outpatient tindakan by doctor + nurse (daftarTindakan)",
    columns: ["no_rawat", "kd_jenis_prw", "kd_dokter", "nip", "tgl_perawatan", "jam_rawat", "biaya_rawat", "stts_bayar"],
    extra: true,
  },
  {
    name: "rawat_inap_dr",
    purpose: "Inpatient tindakan by doctor (daftarTindakan)",
    columns: ["no_rawat", "kd_jenis_prw", "kd_dokter", "tgl_perawatan", "jam_rawat", "biaya_rawat"],
    extra: true,
  },
  {
    name: "rawat_inap_drpr",
    purpose: "Inpatient tindakan by doctor + nurse (daftarTindakan)",
    columns: ["no_rawat", "kd_jenis_prw", "kd_dokter", "nip", "tgl_perawatan", "jam_rawat", "biaya_rawat"],
    extra: true,
  },
  // Patient documents (dokumenPasien): history, CPPT/SOAP and resume.
  {
    name: "pemeriksaan_ralan",
    purpose: "Outpatient CPPT / SOAP: keluhan (S), pemeriksaan + vitals (O), penilaian (A), rtl (P)",
    columns: ["no_rawat", "tgl_perawatan", "jam_rawat", "keluhan", "pemeriksaan", "penilaian", "rtl", "instruksi", "evaluasi", "nip"],
    extra: true,
  },
  {
    name: "pemeriksaan_ranap",
    purpose: "Inpatient CPPT / SOAP, same columns as pemeriksaan_ralan",
    columns: ["no_rawat", "tgl_perawatan", "jam_rawat", "keluhan", "pemeriksaan", "penilaian", "rtl", "instruksi", "evaluasi", "nip"],
    extra: true,
  },
  {
    name: "diagnosa_pasien",
    purpose: "Diagnoses of a visit (ICD-10), with priority",
    columns: ["no_rawat", "kd_penyakit", "status", "prioritas"],
    extra: true,
  },
  {
    name: "penyakit",
    purpose: "ICD-10 master: kd_penyakit -> nm_penyakit",
    columns: ["kd_penyakit", "nm_penyakit"],
    extra: true,
  },
  {
    name: "resume_pasien",
    purpose: "Outpatient medical resume written in Khanza",
    columns: ["no_rawat", "kd_dokter", "keluhan_utama", "jalannya_penyakit", "diagnosa_utama", "kd_diagnosa_utama"],
    extra: true,
  },
  {
    name: "resume_pasien_ranap",
    purpose: "Inpatient medical resume written in Khanza",
    columns: ["no_rawat", "kd_dokter", "keluhan_utama", "jalannya_penyakit", "diagnosa_utama", "kd_diagnosa_utama"],
    extra: true,
  },
  {
    name: "setting",
    purpose: "Hospital name, address and logo (document header)",
    columns: ["nama_instansi", "alamat_instansi", "kabupaten", "propinsi", "kontak", "email", "logo"],
    extra: true,
  },
  {
    name: "petugas",
    purpose: "Staff names (who wrote a CPPT entry, by nip)",
    columns: ["nip", "nama"],
    extra: true,
  },
  {
    name: "periksa_lab",
    purpose: "Lab examinations of a visit",
    columns: ["no_rawat", "kd_jenis_prw", "tgl_periksa", "jam"],
    extra: true,
  },
  {
    name: "detail_periksa_lab",
    purpose: "Lab result values per item",
    columns: ["no_rawat", "kd_jenis_prw", "tgl_periksa", "jam", "id_template", "nilai", "nilai_rujukan", "keterangan"],
    extra: true,
  },
  {
    name: "template_laboratorium",
    purpose: "Lab item names and units (id_template)",
    columns: ["id_template", "kd_jenis_prw", "Pemeriksaan", "satuan"],
    extra: true,
  },
  {
    name: "jns_perawatan_lab",
    purpose: "Lab examination names",
    columns: ["kd_jenis_prw", "nm_perawatan"],
    extra: true,
  },
  {
    name: "hasil_radiologi",
    purpose: "Radiology reports (free text)",
    columns: ["no_rawat", "tgl_periksa", "jam", "hasil"],
    extra: true,
  },
  {
    name: "periksa_radiologi",
    purpose: "Radiology exams done in a visit: exam type, radiologist, date and time (hasilRadiologi)",
    columns: ["no_rawat", "kd_jenis_prw", "tgl_periksa", "jam", "kd_dokter", "dokter_perujuk", "status"],
    extra: true,
  },
  {
    name: "jns_perawatan_radiologi",
    purpose: "Radiology exam types (name of the exam, e.g. Thorax PA)",
    columns: ["kd_jenis_prw", "nm_perawatan"],
    extra: true,
  },
  {
    name: "prosedur_pasien",
    purpose: "Procedures (ICD-9-CM) of a visit, by priority (resume medis)",
    columns: ["no_rawat", "kode", "status", "prioritas"],
    extra: true,
  },
  {
    name: "icd9",
    purpose: "ICD-9-CM procedure names",
    columns: ["kode", "deskripsi_panjang", "deskripsi_pendek"],
    extra: true,
  },
  {
    name: "permintaan_ranap",
    purpose: "Inpatient admission request: reason for admission (resume medis 'alasan')",
    columns: ["no_rawat", "tanggal", "kd_kamar", "diagnosa", "catatan"],
    extra: true,
  },
];

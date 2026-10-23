```json meta
{
  "id": "igd",
  "title": "IGD: triase sampai pasien keluar",
  "keywords": ["igd", "ugd", "gawat darurat", "triase", "emergency", "IGDK"],
  "menus": ["A/IGD/UGD", "M/Data Triase IGD", "M/Awal Keperawatan IGD", "M/Awal Medis IGD", "A/Rawat Inap", "A/Rujukan Keluar"],
  "forms": ["DlgIGD", "RMTriaseIGD", "RMPenilaianAwalKeperawatanIGD", "RMPenilaianAwalMedisIGD", "DlgKamarInap", "DlgRujuk"]
}
```

# IGD: triase sampai pasien keluar

IGD/UGD is not a ward: one emergency visit is one `reg_periksa` row with `kd_poli='IGDK'` and `status_lanjut='Ralan'`. `DlgIGD` is both the registration desk and the service console; the actual triage and assessment records live in the group [M] forms, each with its own access right.

## Steps

### 1. Register the IGD visit
- **Menu:** `A/IGD/UGD` (form `DlgIGD`)
- **Who:** IGD registration staff with the `igd` right.
- **Does:** Search the patient by RM/name, pick the doctor and payer, then Save. The form writes one `reg_periksa` row with `kd_poli='IGDK'`, `status_lanjut='Ralan'`, `stts_daftar` Baru/Lama, and `kd_pj`. If "Asal Rujukan" is filled, a `rujuk_masuk` row is added. Editing an existing registration needs `edit_registrasi` and is refused once a `billing` row exists.
- **Tabel:** `reg_periksa` (write), `rujuk_masuk` (write), `poliklinik` (write, auto-created when IGDK is missing); `pasien`, `dokter`, `penjab` (read).

### 2. Triage
- **Menu:** `M/Data Triase IGD` (form `RMTriaseIGD`)
- **Who:** Triage nurse with `data_triase_igd`. From `DlgIGD` the same form sits under "RM Gawat Darurat" and its menu item is disabled without that right.
- **Does:** Record arrival mode, reason for arrival, case type, then the primary or secondary survey. The form saves the triage header plus detail rows for the chosen triage scale (1-5).
- **Tabel:** `data_triase_igd`, `data_triase_igdprimer`, `data_triase_igdsekunder`, `data_triase_igddetail_skala1`-`5` (write); `master_triase_macam_kasus`, `master_triase_pemeriksaan`, `master_triase_skala1`-`5` (read).

### 3. Initial nursing assessment
- **Menu:** `M/Awal Keperawatan IGD` (form `RMPenilaianAwalKeperawatanIGD`)
- **Who:** IGD nurse with `penilaian_awal_keperawatan_igd`.
- **Does:** Fill vital signs, pain score, risk screens, and nursing problems. Checked problems are saved per `no_rawat`, and the nursing plan is picked from the IGD master tables.
- **Tabel:** `penilaian_awal_keperawatan_igd` (write), `penilaian_awal_keperawatan_igd_masalah` (write), `master_masalah_keperawatan_igd`, `master_rencana_keperawatan_igd` (read).

### 4. Initial medical assessment
- **Menu:** `M/Awal Medis IGD` (form `RMPenilaianAwalMedisIGD`)
- **Who:** IGD doctor with `penilaian_awal_medis_igd`.
- **Does:** Fill history, physical examination, and the initial plan. The form reads the triage record so the doctor sees the scale and complaint already captured by the nurse.
- **Tabel:** `penilaian_medis_igd` (write); `data_triase_igd`, `data_triase_igdprimer`, `data_triase_igdsekunder`, `pemeriksaan_ralan` (read).

### 5. Diagnosis, procedures, and orders
- **Menu:** `A/IGD/UGD` (form `DlgIGD`)
- **Who:** IGD doctor/nurse; each submenu has its own right (`diagnosa_pasien`, `tindakan_ralan`, `permintaan_lab`, `permintaan_radiologi`, `beri_obat`, `resep_obat`).
- **Does:** Select the visit row, then use the form's submenus: "Diagnosa Pasien" for the working diagnosis; "Tagihan/Tindakan Rawat Jalan" opens `DlgRawatJalan` with poli `IGDK`; "Pemeriksaan Lab"/"Pemeriksaan Radiologi" open the request forms with status Ralan; "Pemberian Obat/BHP" records drugs given in the emergency room.
- **Tabel:** `diagnosa_pasien`, `rawat_jl_dr`, `rawat_jl_drpr`, `permintaan_lab`, `permintaan_radiologi`, `resep_obat`, `detail_pemberian_obat` (write); `dokter`, `pasien` (read).

### 6. Disposition: admit to a ward
- **Menu:** `A/Rawat Inap` (form `DlgKamarInap`)
- **Who:** Inpatient admission staff with `kamar_inap`.
- **Does:** Pick a free room, doctor, and initial diagnosis, then Save. The form inserts a `kamar_inap` row with `stts_pulang='-'` and `tgl_keluar='0000-00-00'`, sets `reg_periksa.status_lanjut='Ranap'`, and marks `kamar.status='ISI'`.
- **Tabel:** `kamar_inap` (write), `reg_periksa` (write), `kamar` (write); `bangsal`, `pasien`, `penjab` (read).

### 7. Disposition: discharge or refer out
- **Menu:** `A/Rujukan Keluar` (form `DlgRujuk`)
- **Who:** IGD doctor with `rujukan_keluar`, or the clerk handling the referral letter.
- **Does:** For an external referral, fill the destination hospital, date, reason, and doctor. The form writes `rujuk` and prints the referral letter using the latest diagnosis, lab, and radiology results. A patient going home is billed at `A/Rawat Jalan` (`DlgKasirRalan`).
- **Tabel:** `rujuk` (write); `reg_periksa`, `diagnosa_pasien`, `periksa_lab`, `periksa_radiologi`, `kamar_inap` (read).

## Where it usually goes wrong
- **The patient still has an open inpatient stay.** `DlgIGD` refuses registration with "Pasien sedang dalam masa perawatan di kamar inap..!!" when a `kamar_inap` row with `stts_pulang='-'` exists for that RM. Check `kamar_inap`, not `kamar.status`.
- **Orders after the patient is admitted.** Once a `kamar_inap` row exists, IGD submenus such as "Pemeriksaan Lab" and "Tagihan/Tindakan Rawat Jalan" refuse with "Pasien sudah masuk Kamar Inap. Gunakan billing Ranap..!!". Follow-up orders must go through the inpatient forms.
- **IGDK is auto-created with a zero fee.** If the `poliklinik` row `IGDK` is missing, `DlgIGD` inserts it with `registrasi=0` and `registrasilama=0`, so every IGD visit is free until someone fixes the tariff.
- **`status_lanjut` does not mean "currently admitted".** IGD visits are always written as `Ralan`, and a discharged inpatient keeps `status_lanjut='Ranap'` until the `kamar_inap` row is deleted. Use active `kamar_inap.stts_pulang='-'` rows to find patients still in the hospital.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `reg_periksa` | 1, 6 | write |
| `rujuk_masuk` | 1 | write |
| `poliklinik` | 1 | write/read |
| `pasien`, `dokter`, `penjab` | 1 | read |
| `data_triase_igd` | 2 | write |
| `data_triase_igdprimer`, `data_triase_igdsekunder` | 2 | write |
| `data_triase_igddetail_skala1`-`5` | 2 | write |
| `master_triase_*` | 2 | read |
| `penilaian_awal_keperawatan_igd` | 3 | write |
| `penilaian_awal_keperawatan_igd_masalah` | 3 | write |
| `master_masalah_keperawatan_igd`, `master_rencana_keperawatan_igd` | 3 | read |
| `penilaian_medis_igd` | 4 | write |
| `pemeriksaan_ralan` | 4 | read |
| `diagnosa_pasien` | 5 | write |
| `rawat_jl_dr`, `rawat_jl_drpr` | 5 | write |
| `permintaan_lab`, `permintaan_radiologi` | 5 | write |
| `resep_obat`, `detail_pemberian_obat` | 5 | write |
| `kamar_inap` | 6 | write |
| `kamar` | 6 | write |
| `bangsal` | 6 | read |
| `rujuk` | 7 | write |
| `periksa_lab`, `periksa_radiologi` | 7 | read |

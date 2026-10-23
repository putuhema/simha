```json meta
{
  "id": "master-tarif",
  "title": "Master data dan tarif",
  "keywords": ["master", "tarif", "pasien", "dokter", "kamar", "bangsal", "penjab", "asuransi"],
  "menus": ["M/Pasien", "C/Dokter", "K/Kamar", "K/Asuransi/Askes/Jenis Bayar", "K/Tarif Ralan", "K/Tarif Ranap", "T/Set Penggunaan Tarif"],
  "forms": ["DlgPasien", "DlgDokter", "DlgKamar", "DlgPenanggungJawab", "DlgJnsPerawatanRalan", "DlgJnsPerawatanRanap", "DlgSetTarif", "DlgRawatJalan"]
}
```

# Master data dan tarif

Registration cannot start without a patient, a doctor, a poli and a payer; billing cannot price a
service without a tariff row that matches the patient's payer and the treating unit. Those five
masters live in **M** (patient), **C** (doctor) and **K** (room, payer, tariffs). They are edited in
place, and transactions copy the values they need at save time, so a master edit never rewrites
history. Forms in this file use `Sequel.menyimpan` / `Sequel.mengedit`; the write tables below were
confirmed in the Java source, not only in `index.json`.

## Steps

### 1. Create the patient
- **Menu:** `M/Pasien` (form `DlgPasien`)
- **Who:** front office / medical records with `pasien`; the "Gabungkan Data RM" action needs `gabung_rm`.
- **Does:** allocates the No. RM from the format in `set_urut_no_rkm_medis` plus the last number in `set_no_rkm_medis`, then stores identity, address, default payer (`kd_pj`) and the TNI/POLRI extension rows. The generated number is written back to `set_no_rkm_medis`.
- **Tabel:** writes `pasien`, `pasien_tni`, `pasien_polri`, `set_no_rkm_medis` (`personal_pasien` only when issuing portal credentials); reads `penjab`, `dokter`, `reg_periksa`, `set_urut_no_rkm_medis`, `setting`.

### 2. Add the doctor
- **Menu:** `C/Dokter` (form `DlgDokter`)
- **Who:** HR or medical administration with `dokter`.
- **Does:** `kd_dokter` doubles as `pegawai.nik`; the first save inserts an employee row and `-` placeholder rows in job/education lookups, and requires a specialty (`kd_sps`). "Hapus" sets `dokter.status='0'` and `pegawai.stts_aktif='KELUAR'` instead of deleting.
- **Tabel:** writes `dokter`, `pegawai`; reads `spesialis`, `setting`.

### 3. Define ward, room and bed rate
- **Menu:** `K/Kamar` (form `DlgKamar`); `bangsal` itself is added from the ward picker's **Tambah** button (`DlgCariBangsal` → `DlgBangsal`, no menu path of its own).
- **Who:** finance or billing admin with `kamar`.
- **Does:** one `kamar` row per bed: ward, class (`Kelas 1`, `Kelas 2`, `Kelas 3`, `Kelas Utama`, `Kelas VIP`, `Kelas VVIP`), daily rate `trf_kamar`, and bed status (`ISI`, `KOSONG`, `DIBERSIHKAN`, `DIBOOKING`). "Hapus" sets `statusdata='0'`; the row stays.
- **Tabel:** writes `kamar`, and `bangsal` through the picker; reads `bangsal`, `set_jam_minimal`, `setting`.

### 4. Register the payer / insurance
- **Menu:** `K/Asuransi/Askes/Jenis Bayar` (form `DlgPenanggungJawab`)
- **Who:** finance with `cara_bayar`.
- **Does:** `kd_pj` is `char(3)` and is joined by patients, registrations and every tariff row, so the code must stay three characters. Stores `png_jawab`, company, address and contact; the "Ambil Photo" action hands off to the web module (`dokumenasuransi/login.php`) to attach a cooperation document and its expiry in `penjab_dokumen_kerjasama`. "Hapus" sets `status='0'`.
- **Tabel:** writes `penjab`, `penjab_dokumen_kerjasama`; reads `penjab`, `penjab_dokumen_kerjasama`.

### 5. Price outpatient services
- **Menu:** `K/Tarif Ralan` (form `DlgJnsPerawatanRalan`)
- **Who:** finance / casemix with `tarif_ralan`.
- **Does:** one `jns_perawatan` row per service + payer + poli. New codes are auto-numbered with an `RJ` prefix, and `kd_jenis_prw` is the primary key, so another payer or poli means a new row, not an edit. Components are `material` (J.S. Rumah Sakit), `bhp`, `tarif_tindakandr`, `tarif_tindakanpr`, `kso`, `menejemen` and the three totals. "Hapus" sets `status='0'`.
- **Tabel:** writes `jns_perawatan`; reads `kategori_perawatan`, `penjab`, `poliklinik`, `setting`.

### 6. Price inpatient services and class
- **Menu:** `K/Tarif Ranap` (form `DlgJnsPerawatanRanap`)
- **Who:** finance / casemix with `tarif_ranap`.
- **Does:** the same components in `jns_perawatan_inap`, scoped by `kd_bangsal` + `kelas` + `kd_pj`. This prices actions during a stay; the daily bed charge remains `kamar.trf_kamar` from step 3.
- **Tabel:** writes `jns_perawatan_inap`; reads `bangsal`, `kategori_perawatan`, `penjab`, `setting`.

### 7. Confirm the tariff is actually offered
- **Menu:** `T/Set Penggunaan Tarif` (form `DlgSetTarif`), then `A/Tindakan Ralan` (form `DlgRawatJalan`)
- **Who:** hospital IT with `set_penggunaan_tarif`, plus a finance user who can enter tindakan (`tindakan_ralan`).
- **Does:** `set_tarif` is a one-row table of `Yes`/`No` switches (`poli_ralan`, `cara_bayar_ralan`, `ruang_ranap`, `cara_bayar_ranap`, `kelas_ranap`, …); only one row is allowed, and Edit deletes then re-inserts it. The billing tariff picker reads those switches, filters `jns_perawatan` by the patient's `kd_pj` and the unit's `kd_poli` (also accepting `-` wildcard rows), then copies the chosen amounts into `rawat_jl_dr` / `rawat_jl_drpr`.
- **Tabel:** writes `set_tarif`, `rawat_jl_dr` / `rawat_jl_drpr`; reads `set_tarif`, `jns_perawatan`, `reg_periksa`.

## Where it usually goes wrong

- **"Hapus" is a soft delete, not a delete.** Tariffs, doctors, payers, rooms and wards all get a status flag (`jns_perawatan.status='0'`, `dokter.status='0'`, `penjab.status='0'`, `kamar.statusdata='0'`, `bangsal.status='0'`). The row vanishes from menus and from the billing picker (`status='1'`), but old transactions still reference it — do not "clean up" master rows with `DELETE`.
- **Tariff edits are not retroactive.** Billing copies the amounts into `rawat_jl_dr` / `rawat_inap_dr` when the action is saved, and the I-group reports sum those stored columns. Changing a price in K/Tarif Ralan only affects actions entered afterwards; correcting an old bill means correcting the transaction row, not the master.
- **Scope and switches decide visibility.** A tariff row is offered only when payer and unit match (or the row uses `-`), and `T/Set Penggunaan Tarif` can skip either filter: with `cara_bayar_ralan=No` the payer filter is ignored (prices for other payers appear), and with `poli_ralan=No` the unit filter is ignored. Check both the row's `kd_pj` / `kd_poli` / `kd_bangsal` / `kelas` and the `set_tarif` switches before declaring a tariff "missing".
- **Merging RM is not duplicate cleanup.** "Gabungkan Data RM" rewrites `no_rkm_medis` keys across `reg_periksa` and about 30 other tables to the target RM, with no undo. Merge only when two record numbers are genuinely the same person.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `pasien` | 1 | write |
| `pasien_tni`, `pasien_polri` | 1 | write |
| `personal_pasien` | 1 | write (portal credentials) |
| `set_no_rkm_medis` | 1 | write |
| `set_urut_no_rkm_medis` | 1 | read |
| `dokter`, `pegawai` | 2 | write |
| `spesialis` | 2 | read |
| `kamar` | 3 | write |
| `bangsal` | 3, 6 | write (via picker) / read |
| `penjab` | 1, 4, 5, 6 | write in 4, read elsewhere |
| `penjab_dokumen_kerjasama` | 4 | write (photo hand-off) |
| `jns_perawatan` | 5, 7 | write / read |
| `kategori_perawatan` | 5, 6 | read |
| `poliklinik` | 5 | read |
| `setting` | 1–3, 5, 6 | read |
| `jns_perawatan_inap` | 6 | write |
| `set_tarif` | 7 | read/write |
| `rawat_jl_dr`, `rawat_jl_drpr` | 7 | write |

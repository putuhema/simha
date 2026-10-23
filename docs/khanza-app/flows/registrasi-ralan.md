```json meta
{
  "id": "registrasi-ralan",
  "title": "Registrasi rawat jalan sampai kasir",
  "keywords": ["registrasi", "pendaftaran", "daftar", "ralan", "rawat jalan", "loket", "kasir"],
  "menus": ["A/Registrasi", "A/Tindakan Ralan", "A/Rawat Jalan"],
  "forms": ["DlgReg", "DlgRawatJalan", "DlgKasirRalan"]
}
```

# Registrasi rawat jalan sampai kasir

A loket clerk opens the visit in `A/Registrasi`; the poli records the examination, charges and drugs in `A/Tindakan Ralan`; the cashier assembles and settles the bill in `A/Rawat Jalan`. The flow starts when a `reg_periksa` row is inserted with `status_lanjut = 'Ralan'` and ends when that row reads `status_bayar = 'Sudah Bayar'` and `stts = 'Sudah'`.

## Steps

### 1. Register the patient at the loket
- **Menu:** `A/Registrasi` (form `DlgReg`)
- **Who:** loket pendaftaran
- **Does:** find the patient by RM/NIK/name (new patients are created at `M/Pasien`), choose poliklinik, dokter, jenis bayar (`penjab`), biaya registrasi and penanggung jawab, fill asal rujukan when the patient brings one, and print the registration slip. **Simpan** calls `isRegistrasi()`, which inserts `reg_periksa` with `status_lanjut='Ralan'`, `stts='Belum'`, `status_bayar='Belum Bayar'` and `stts_daftar` set to `Lama` only when the RM already has a visit at the same poli; `UpdateUmur()` then rewrites `pasien.umur`.
- **Hak akses:** `registrasi` — the menu right, so a user without it never sees the button.
- **Tabel:** `reg_periksa` (insert), `pasien` (update), `rujuk_masuk` (insert when asal rujukan is filled), `antriloket` (insert when the loket queue is called), `booking_registrasi` (read).

### 2. Examine the patient and record the poli charges
- **Menu:** `A/Tindakan Ralan` (form `DlgRawatJalan`)
- **Who:** dokter poli, perawat, bidan
- **Does:** pick the visit by `no_rawat` or from the day's list. The **Pemeriksaan** tab writes vital signs, keluhan, pemeriksaan, penilaian, tindak lanjut, instruksi and evaluasi into `pemeriksaan_ralan`; the **Penanganan Dokter**, **Penanganan Petugas** and **Penanganan Dokter & Petugas** tabs add the charged actions to `rawat_jl_dr`, `rawat_jl_pr` and `rawat_jl_drpr`; the **Catatan Dokter** tab adds `catatan_perawatan`. Lab and radiology requests are launched from the same screen. If the patient has to be admitted, the **Kamar** button (right `kamar_inap`) opens the rawat-inap bed form with this visit prefilled.
- **Hak akses:** `tindakan_ralan` enables Simpan/Hapus/Edit/Print; `tarif_ralan` enables adding a new tarif; `pemeriksaan_ralan` rows can only be saved by the logged-in user whose kode equals the selected KdPeg, unless the user is `Admin Utama`.
- **Tabel:** `pemeriksaan_ralan` (insert), `rawat_jl_dr` / `rawat_jl_pr` / `rawat_jl_drpr` (insert), `catatan_perawatan` (insert), `jns_perawatan` (read).

### 3. Give the drugs and BHP from the poli
- **Menu:** `A/Tindakan Ralan` (form `DlgRawatJalan`)
- **Who:** dokter (order), perawat or farmasi (hand-over)
- **Does:** the **Obat/BHP** button opens the drug dialog (`DlgPemberianObat`) for this `no_rawat` with status `ralan`; each item becomes a `detail_pemberian_obat` row with `status='Ralan'` plus its dosing rule in `aturan_pakai`, and the amount is picked up by the bill later. The **Resep** button (`resep_dokter`) records the prescription for the pharmacy, which dispenses it at `A/No. Resep`. Opening `A/Beri Obat/BHP` directly from Menu only shows the day's rows; its entry dialog needs a visit context and otherwise says "Hanya bisa lewat Kasir Ralan atau Kamar Inap".
- **Hak akses:** `beri_obat` shows the Obat/BHP and Input Obat buttons; `resep_dokter` shows the Resep buttons.
- **Tabel:** `detail_pemberian_obat` (insert), `aturan_pakai` (insert), `databarang` (read), `stok_obat_pasien` (read).

### 4. Open the bill at the cashier
- **Menu:** `A/Rawat Jalan` (form `DlgKasirRalan`)
- **Who:** kasir / keuangan
- **Does:** the table lists `reg_periksa` with `status_lanjut='Ralan'` for the chosen date range, filterable by cara bayar, poli, dokter, status, status bayar and "Sudah/Belum resume". Select the row and use **Billing/Pembayaran Pasien**; the billing screen pulls the charges from tindakan, drugs, lab, radiology, operations and the registration fee, and lets you add tambahan or potongan. A patient who already has a `kamar_inap` row is refused here with "Pasien sudah masuk Kamar Inap. Gunakan billing Ranap..!!" — hand that visit to the rawat-inap flow.
- **Hak akses:** the menu appears when `kasir_ralan` **or** `billing_ralan` is true (`frmUtama` checks both); the billing screen only opens when `billing_ralan` is true.
- **Tabel:** `reg_periksa`, `rawat_jl_dr` / `rawat_jl_pr` / `rawat_jl_drpr`, `detail_pemberian_obat`, `tambahan_biaya`, `pengurangan_biaya` (all read).

### 5. Save the payment and print the nota
- **Menu:** `A/Rawat Jalan` (form `DlgKasirRalan`)
- **Who:** kasir
- **Does:** fill the akun bayar (more than one is allowed) and, when the payer does not settle in full, the piutang. **Simpan** refuses unless every charge group checkbox is shown and `kekurangan = 0`; it then writes `nota_jalan` (number `YYYY/MM/DD/RJ####`), one `billing` row per bill line, `detail_nota_jalan` per account with its PPN, `tambahan_biaya` / `pengurangan_biaya` for signed adjustments, `piutang_pasien` + `detail_piutang_pasien` when there is a remainder, and finally sets `reg_periksa.status_bayar='Sudah Bayar'`. The nota and kwitansi are printed from this screen.
- **Hak akses:** `billing_ralan`.
- **Tabel:** `nota_jalan` (insert), `billing` (insert), `detail_nota_jalan` (insert), `piutang_pasien` and `detail_piutang_pasien` (insert only when there is piutang), `reg_periksa` (update `status_bayar`).

### 6. Close the visit
- **Menu:** `A/Tindakan Ralan` (form `DlgRawatJalan`)
- **Who:** perawat poli / admin rekam medis
- **Does:** closing the poli form asks "Mau skalian update status pasien sudah diperiksa ????". Answering Yes sets `reg_periksa.stts='Sudah'` and writes a `mutasi_berkas` row with status `Sudah Kembali`, so the RM is back in the filing room. Nothing on this screen touches the money; payment stays a cashier action.
- **Tabel:** `reg_periksa` (update `stts`), `mutasi_berkas` (insert).

## Where it usually goes wrong

- An unpaid earlier visit stops the loket when `set_validasi_registrasi.wajib_closing_kasir = 'Yes'`: `isPas()` refuses the patient with "pasien pada kunjungan sebelumnya memiliki tagihan yang belum di closing" if any earlier `reg_periksa` row is `status_bayar='Belum Bayar'` and not `Batal`. Settle it at the cashier instead of editing the row.
- A still-open inpatient stay blocks registration: the same screen answers "Pasien sedang dalam masa perawatan di kamar inap..!!" when a `kamar_inap` row with `stts_pulang='-'` exists for the RM. A transfer or checkout that left an extra open row produces the same message.
- Billing freezes the clinical side: `Sequel.cariRegistrasi()` counts `billing` rows (plus `stts='Batal'` registrations), so after the cashier has saved, `A/Tindakan Ralan` and the drug dialog answer "Data billing sudah terverifikasi" and refuse edits and deletes. Delete the nota from the billing screen before correcting a charge.
- Numbering and quota: with `aktifjadwal` on, the save stops at `kuota` registrations for that dokter and date ("Eiiits, Kuota registrasi penuh..!!!"); `no_reg` and `no_rawat` come from MAX values with a retry loop in `isNumber()`, so rows inserted outside the app or a restored backup can make a valid-looking save fail. Non-`Admin Utama` users also cannot backdate the registration when `TANGGALMUNDUR` is off.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `reg_periksa` | 1, 4, 5, 6 | write insert (1), `status_bayar` (5), `stts` (6); read (4) |
| `pasien` | 1 | write `umur`; read for lookup |
| `rujuk_masuk` | 1 | write, only when asal rujukan is filled |
| `antriloket` | 1 | write, only when the loket queue is called |
| `booking_registrasi` | 1 | read (booking poli/dokter/date and `no_reg`) |
| `pemeriksaan_ralan` | 2 | write |
| `rawat_jl_dr`, `rawat_jl_pr`, `rawat_jl_drpr` | 2, 4 | write (2); read by the bill (4) |
| `catatan_perawatan` | 2 | write |
| `jns_perawatan` | 2 | read (tarif and names) |
| `detail_pemberian_obat` | 3, 4, 5 | write (3); read by the bill (4, 5) |
| `aturan_pakai` | 3 | write |
| `nota_jalan` | 4, 5 | read existing nota (4); write (5) |
| `billing` | 5 | write |
| `detail_nota_jalan` | 5 | write (per akun bayar, with PPN) |
| `tambahan_biaya`, `pengurangan_biaya` | 5 | write (signed bill lines) |
| `piutang_pasien`, `detail_piutang_pasien` | 5 | write, only when there is a remainder |
| `mutasi_berkas` | 6 | write (`Sudah Kembali`) |
| `poliklinik`, `dokter`, `penjab` | 1, 4 | read |
| `diagnosa_pasien` | 2 | write through the diagnosis panel opened from the form |

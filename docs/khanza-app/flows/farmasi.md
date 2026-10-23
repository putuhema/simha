```json meta
{
  "id": "farmasi",
  "title": "Farmasi: resep sampai retur obat",
  "keywords": ["farmasi", "resep", "obat", "apotek", "beri obat", "retur obat", "stok obat"],
  "menus": ["A/No. Resep", "A/Beri Obat/BHP", "A/Resep Pulang", "D/Daftar Resep Dokter", "D/Stok Obat Pasien", "D/Mutasi Obat & BHP", "D/Retur Obat Ranap"],
  "forms": ["DlgResepObat", "DlgPemberianObat", "DlgResepPulang", "DlgDaftarPermintaanResep", "DlgStokPasien", "DlgMutasiBarang", "DlgReturObatPasien"]
}
```

# Farmasi: resep sampai retur obat

A prescription is written by the doctor from the examination screen — there is no "prescribe"
menu. The pharmacy validates it, dispenses it (stock leaves the depo), records patient stock, and
returns stock. Movements touch `gudangbarang`, plus `data_batch` when batch tracking is on.

## Steps

### 1. Dokter menulis resep
- **Menu:** `A/Tindakan Ralan` (form `DlgRawatJalan`), `A/Rawat Jalan` (form `DlgKasirRalan`), or
  `A/Rawat Inap` (form `DlgKamarInap`)
- **Who:** dokter with right `resep_dokter`.
- **Does:** "Input Resep" opens `DlgPeresepanDokter` (a dialog, not a menu form). The header
  (`resep_obat`) and drug lines (`resep_dokter`) are written together; compound drugs go to
  `resep_dokter_racikan` and `resep_dokter_racikan_detail`.
- **Tabel:** write `resep_obat`, `resep_dokter`, `resep_dokter_racikan`,
  `resep_dokter_racikan_detail`; read `reg_periksa`, `pasien`, `databarang`, `gudangbarang`,
  `dokter`.

### 2. Apotek memvalidasi resep dan mencetak etiket
- **Menu:** `D/Daftar Resep Dokter` (form `DlgDaftarPermintaanResep`); `A/No. Resep`
  (form `DlgResepObat`)
- **Who:** apoteker with `resep_dokter`/`resep_obat`; validating needs `beri_obat`.
- **Does:** the Daftar Resep lists prescriptions per date for ralan/ranap. Validating queues the
  resep (`antriapotek2`/`antriapotek3`) and opens the drug picker; a resep whose
  `resep_obat.tgl_perawatan` is set shows "Sudah Terlayani" and cannot be validated twice. No. Resep
  records the header and prints "Daftar Pemberian Obat Resep", "Lembar Pemberian Obat", "Label
  Obat", and "Cetak Aturan Pakai". Telaah is separate: `D/Telaah Resep & Obat` writes
  `telaah_farmasi`.
- **Tabel:** read `resep_obat`, `resep_dokter`, `resep_dokter_racikan`,
  `resep_dokter_racikan_detail`, `detail_pemberian_obat`, `aturan_pakai`, `obat_racikan`,
  `databarang`, `kodesatuan`, `metode_racik`, `pasien`, `dokter`, `penjab`, `reg_periksa`,
  `telaah_farmasi`, `set_depo_ralan`, `set_depo_ranap`, `set_lokasi`; write `resep_obat`,
  `aturan_pakai`, `obat_racikan`, `antriapotek2`, `antriapotek3`, `temporary_resep`,
  `bukti_penyerahan_resep_obat` (deleted on re-validation).

### 3. Obat diserahkan (beri obat/BHP)
- **Menu:** `A/Beri Obat/BHP` (form `DlgPemberianObat`)
- **Who:** petugas farmasi with `beri_obat`.
- **Does:** this form is the register; entry happens in the picker it opens (`DlgCariObat` for
  ralan, `DlgCariObat2` for ranap), normally from step 2. Each line inserts
  `detail_pemberian_obat`, writes `aturan_pakai`, decrements `gudangbarang` and `data_batch.sisa`,
  and sets `resep_obat.tgl_perawatan` so the resep becomes "Sudah Terlayani". Deleting a line
  restores stock and rewrites `tampjurnal`.
- **Tabel:** write `detail_pemberian_obat`, `aturan_pakai`, `gudangbarang`, `data_batch`,
  `resep_obat`, `tampjurnal`; read `databarang`, `stok_obat_pasien`, `diagnosa_pasien`,
  `reg_periksa`, `set_akun_ralan`, `set_akun_ranap`, `set_input_parsial`, `setting`.

### 4. Stok pasien dan mutasi depo
- **Menu:** `D/Stok Obat Pasien` (form `DlgStokPasien`); `D/Mutasi Obat & BHP`
  (form `DlgMutasiBarang`)
- **Who:** petugas farmasi/gudang with `stok_obat_pasien` / `mutasi_barang`.
- **Does:** patient stock (`stok_obat_pasien`) is created from the ward screen (`A/Rawat Inap`,
  dialog `DlgInputStokPasien`), which also decrements `gudangbarang`; `D/Stok Obat Pasien` is the
  read/print view and its delete returns stock. Mutasi moves stock between depo via `mutasibarang`
  plus minus/plus `gudangbarang` rows; "Dari" ≠ "Ke", "Keterangan" and batch/faktur are required.
- **Tabel:** write `stok_obat_pasien`, `gudangbarang`, `data_batch`, `mutasibarang`,
  `permintaan_stok_obat_pasien` (`status='Sudah'`); read `databarang`, `bangsal`, `kamar`,
  `kamar_inap`, `set_lokasi`, `set_depo_ranap`.

### 5. Resep pulang
- **Menu:** `A/Resep Pulang` (form `DlgResepPulang`)
- **Who:** petugas farmasi with `resep_pulang`.
- **Does:** lists take-home drugs per patient and date. Entry is `DlgInputResepPulang` (from
  `A/Rawat Inap` and the inpatient billing dialog): it inserts `resep_pulang`, decrements
  `gudangbarang`/`data_batch`, and marks `permintaan_resep_pulang.status='Sudah'`. Deleting a row
  in `DlgResepPulang` restores the stock.
- **Tabel:** write `resep_pulang`, `gudangbarang`, `data_batch`, `permintaan_resep_pulang`; read
  `databarang`, `kodesatuan`, `jenis`, `bangsal`, `kamar`, `kamar_inap`, `set_depo_ranap`,
  `set_lokasi`, `reg_periksa`, `pasien`.

### 6. Retur obat
- **Menu:** `D/Retur Obat Ranap` (form `DlgReturObatPasien`)
- **Who:** petugas farmasi with `retur_obat_ranap`.
- **Does:** lists returns (`returpasien`) per date, patient, drug, and batch; its delete puts stock
  back (`gudangbarang`, `data_batch.sisa`) and removes the row. Returns are entered from
  `A/Beri Obat/BHP` via the "Retur Obat Ke" dialog (`DlgCariObat3`), which adds stock back.
- **Tabel:** write `returpasien`, `gudangbarang`, `data_batch`; read `databarang`, `reg_periksa`,
  `pasien`, `stok_obat_pasien`.

## Where it usually goes wrong

- All dispensing paths share one lock: `Sequel.cariRegistrasi` counts rows in `billing`, not
  payments. Once the kasir writes a bill, validation and drug entry refuse with "Data billing sudah
  terverifikasi" — except for partial-input (`set_input_parsial`) patients.
- "Sudah Terlayani" is not a status column; it is derived from `resep_obat.tgl_perawatan`. Giving
  the drug outside the resep flow leaves the queue showing the resep as unserved.
- A retur replaces instead of accumulating: `DlgCariObat3` deletes the existing `returpasien` row
  for the same patient + drug + batch before inserting, so two partial returns on different dates
  cannot both be recorded.
- Deleting from `A/Resep Pulang` restores stock but leaves `permintaan_resep_pulang.status='Sudah'`,
  so a canceled take-home resep never returns to the ward request list.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `resep_obat` | 1, 2, 3 | write (insert 1-2, `tgl_perawatan` 3) / read |
| `resep_dokter`, `resep_dokter_racikan`, `resep_dokter_racikan_detail` | 1, 2 | write / read |
| `detail_pemberian_obat`, `aturan_pakai`, `obat_racikan` | 2, 3 (`obat_racikan` 2) | write / read |
| `gudangbarang`, `data_batch` | 3, 4, 5, 6 | write |
| `stok_obat_pasien` | 3, 4, 6 | write (4) / read |
| `mutasibarang` | 4 | write |
| `resep_pulang` | 5 | write / read |
| `returpasien` | 6 | write |
| `permintaan_stok_obat_pasien`, `permintaan_resep_pulang` | 4, 5 | write (status, validation time) |
| `temporary_resep`, `antriapotek2`, `antriapotek3`, `bukti_penyerahan_resep_obat` | 2 | write |
| `tampjurnal` | 3 | write |
| `databarang`, `jenis`, `kodesatuan`, `metode_racik`, `bangsal`, `kamar`, `kamar_inap`, `reg_periksa`, `pasien`, `dokter`, `penjab`, `set_depo_ralan`, `set_depo_ranap`, `set_lokasi`, `set_akun_ralan`, `set_akun_ranap`, `setting` | 1-6 | read |

```json meta
{
  "id": "radiologi",
  "title": "Radiologi: permintaan sampai hasil",
  "keywords": ["radiologi", "rontgen", "x-ray", "usg", "ct", "permintaan radiologi"],
  "menus": ["A/Permintaan Radiologi", "A/Periksa Radiologi"],
  "forms": ["DlgCariPermintaanRadiologi", "DlgCariPeriksaRadiologi"]
}
```

# Radiologi: permintaan sampai hasil

A radiology order starts on the doctor's examination screen, not in the radiology menu: the
department's own menu (`A/Permintaan Radiologi`) is the worklist that receives it. One request
(`permintaan_radiologi`) carries several examinations (`permintaan_pemeriksaan_radiologi`), and the
charge only appears when the examination result is saved. The patient's visit (`no_rawat`) is the
thread that ties the order, the examination, and the bill together. Menu paths below follow
**Menu** → `cmbMenu` group → button.

## Steps

### 1. Dokter menulis permintaan
- **Menu:** `A/Tindakan Ralan` (form `DlgRawatJalan`); for inpatients `A/Rawat Inap`
  (form `DlgKamarInap`)
- **Who:** dokter/DPJP with right `permintaan_radiologi`.
- **Does:** the "Permintaan Rad" button opens `DlgPermintaanRadiologi` (a dialog, not a menu
  form). Pick the visit, the referring doctor, fill "Informasi Tambahan Permintaan Foto" and
  "Indikasi Pemeriksaan / Diagnosis Klinis", tick the examinations, then save.
- **Tabel:** write `permintaan_radiologi` and `permintaan_pemeriksaan_radiologi` (inserted by that
  dialog, seen in source); read `reg_periksa`, `pasien`, `dokter`, `jns_perawatan_radiologi`,
  `penjab`, `poliklinik`.

### 2. Petugas mengambil worklist dan sampel
- **Menu:** `A/Permintaan Radiologi` (form `DlgCariPermintaanRadiologi`)
- **Who:** petugas radiologi with `permintaan_radiologi`.
- **Does:** two tabs, Ralan and Ranap, filtered by date, `noorder`, patient, doctor, or penjab. The
  "Sampel" button opens the `WindowAmbilSampel` dialog, which writes `tgl_sampel`/`jam_sampel` and
  resets the queue counter; "Hasil" opens `DlgPeriksaRadiologi`; "Hapus" cancels the request.
- **Tabel:** read `permintaan_radiologi`, `permintaan_pemeriksaan_radiologi`, `reg_periksa`,
  `pasien`, `dokter`, `poliklinik`, `penjab`, `bangsal`, `kamar_inap`, `jns_perawatan_radiologi`;
  write `permintaan_radiologi` (sample time, delete), `antriradiologi`,
  `temporary_permintaan_radiologi`.

### 3. Pemeriksaan dan pembacaan hasil
- **Menu:** `A/Permintaan Radiologi` (dialog `DlgPeriksaRadiologi`, opened from the worklist's
  result button)
- **Who:** dokter radiologi/petugas with `periksa_radiologi`.
- **Does:** add examination rows (projection, kV, mAs, FFD, BSF, film count, dose), BHP lines
  picked from `ipsrsbarang`, a free-text result, and an image/DICOM URL. Saving inserts the charge
  rows, stamps `tgl_hasil`/`jam_hasil` on the request, and resets the ralan queue. Saving is
  append-only: the dialog never reads or updates an existing examination, so saving twice for the
  same visit adds a second `periksa_radiologi` row and a second result at the new
  `tgl_periksa`/`jam`. The BHP lines are charges only — this dialog never touches `gudangbarang`.
- **Tabel:** write `periksa_radiologi`, `beri_bhp_radiologi`, `hasil_radiologi`,
  `gambar_radiologi`, `permintaan_radiologi`, `antriradiologi2`, `tampjurnal`,
  `temporary_radiologi`; read `jns_perawatan_radiologi`, `ipsrsbarang`, `set_akun_ralan`,
  `set_akun_ranap`, `setting`.

### 4. Hasil dibaca, dicetak, dikoreksi
- **Menu:** `A/Periksa Radiologi` (form `DlgCariPeriksaRadiologi`)
- **Who:** petugas radiologi with `periksa_radiologi`; attaching files also needs
  `berkas_digital_perawatan`, printing a resume needs `resume_pasien`.
- **Does:** browse saved examinations by date and patient, print "Data Pemeriksaan Radiologi", open
  the image/DICOM, use "Ubah P.J.Lab, Perujuk & Petugas" to correct the fee owners, or delete an
  examination. Delete removes the exam, its result, its image, and its BHP rows and rewrites the
  journal, but leaves `permintaan_radiologi.tgl_hasil` set.
- **Tabel:** read `periksa_radiologi`, `hasil_radiologi`, `gambar_radiologi`, `beri_bhp_radiologi`,
  `pasien`, `dokter`, `petugas`, `reg_periksa`, `penjab`, `jns_perawatan_radiologi`; write
  `periksa_radiologi`, `hasil_radiologi`, `gambar_radiologi`, `beri_bhp_radiologi` (delete) and
  `tampjurnal`; `temporary_radiologi` for print.

### 5. Billing dan pembayaran
- **Menu:** `A/Rawat Jalan` (form `DlgKasirRalan`) for outpatients; `A/Rawat Inap`
  (form `DlgKamarInap`) opens the inpatient billing dialog
- **Who:** kasir with `billing_ralan`/`billing_ranap`; viewing the radiology lines needs
  `periksa_radiologi`.
- **Does:** the saved examinations are the charge lines. Kasir builds the bill from them, prints the
  nota, and takes payment; after that, radiology can no longer change the request. Doctor-fee rows
  for the same examinations are paid separately in `K/Bayar JM Dokter`
  (`KeuanganBayarJMDokter`), which fills `bayar_periksa_radiologi` and
  `bayar_periksa_radiologi_perujuk`. Billing parsial (`DlgBilingParsialRalan`) is the path that
  marks `permintaan_pemeriksaan_radiologi.stts_bayar='Sudah'`.
- **Tabel:** read `periksa_radiologi`, `permintaan_radiologi`; write `billing`, `nota_jalan`,
  `detail_nota_jalan` (ralan), `nota_inap`, `detail_nota_inap` (ranap), `tampjurnal`.

## Where it usually goes wrong

- `DlgPermintaanRadiologi` refuses to save when "Informasi Tambahan" or "Diagnosis Klinis" is
  empty, so a doctor cannot send a bare "foto thorax" order — both fields are mandatory.
- Deleting from the worklist only works before the sample is taken; once `tgl_sampel` is set the
  form says "Maaf, Sudah dilakukan pengambilan sampel" for every user except `Admin Utama`. It is
  also blocked when any examination for that order has `stts_bayar='Sudah'`.
- The "billing sudah terverifikasi" lock is not about payment: `Sequel.cariRegistrasi` counts rows
  in `billing` for the visit (plus canceled registrations). As soon as the kasir writes the bill,
  request edits fail with "Data billing sudah terverifikasi" — except for partial-input
  (`set_input_parsial`) patients.
- Deleting a request removes only the `permintaan_radiologi` header; the
  `permintaan_pemeriksaan_radiologi` rows are left behind, so reports that join the detail table
  can still count a canceled order.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `permintaan_radiologi` | 1, 2, 3, 5 | write (insert 1, sample 2, `tgl_hasil` 3, delete 2) / read |
| `permintaan_pemeriksaan_radiologi` | 1, 2 | write (insert 1) / read |
| `periksa_radiologi` | 3, 4, 5 | write (insert 3, update/delete 4) / read |
| `hasil_radiologi`, `gambar_radiologi` | 3, 4 | write / read |
| `beri_bhp_radiologi` | 3, 4 | write / read |
| `antriradiologi`, `antriradiologi2` | 2, 3 | write |
| `temporary_permintaan_radiologi`, `temporary_radiologi` | 2, 3, 4 | write |
| `billing` | 5 | write |
| `tampjurnal` | 3, 4, 5 | write |
| `nota_jalan`, `detail_nota_jalan` | 5 | write |
| `nota_inap`, `detail_nota_inap` | 5 | write |
| `reg_periksa`, `pasien`, `dokter`, `petugas`, `penjab`, `poliklinik`, `bangsal`, `kamar_inap`, `jns_perawatan_radiologi`, `ipsrsbarang`, `set_akun_ralan`, `set_akun_ranap` | 1-5 | read |

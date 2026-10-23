```json meta
{
  "id": "laboratorium",
  "title": "Laboratorium: permintaan sampai billing",
  "keywords": ["laboratorium", "lab", "permintaan lab", "sampel", "hasil lab", "billing lab", "PA", "MB"],
  "menus": ["A/Permintaan Lab PK", "A/Permintaan Lab PA", "A/Permintaan Lab MB", "A/Periksa Lab PK", "A/Periksa Lab PA", "A/Periksa Lab MB", "A/Rawat Jalan"],
  "forms": ["DlgCariPermintaanLab", "DlgCariPermintaanLabPA", "DlgCariPermintaanLabMB", "DlgCariPeriksaLab", "DlgCariPeriksaLabPA", "DlgCariPeriksaLabMB", "DlgKasirRalan"]
}
```

# Laboratorium: permintaan sampai billing

The lab runs three parallel lines: **PK** (klinik/kimia), **PA** (patologi anatomi), and **MB** (mikrobiologi). Each line has a "Permintaan" worklist and a "Periksa" result browser. The request itself is created from the clinical form, not from the lab worklist; the lab starts working when that request appears here.

## Steps

### 1. Receive and print the request
- **Menu:** `A/Permintaan Lab PK` (form `DlgCariPermintaanLab`)
- **Who:** Lab counter staff with `permintaan_lab`.
- **Does:** Filter Ralan/Ranap by date, doctor, unit, or room, then select the request. Check the referring doctor and clinical diagnosis, then print the request sheet and/or the request barcode. The rows were written by the clinical form (`DlgPermintaanLaboratorium`, opened from IGD, outpatient, or inpatient); this screen is a worklist, not an order-entry form.
- **Tabel:** `permintaan_lab`, `permintaan_pemeriksaan_lab`, `permintaan_detail_permintaan_lab`, `reg_periksa`, `pasien`, `dokter`, `penjab` (read).

### 2. Take the sample
- **Menu:** `A/Permintaan Lab PK` (form `DlgCariPermintaanLab`)
- **Who:** Phlebotomist/lab staff with `permintaan_lab`.
- **Does:** Click "Sampel" and save the sample time. The form updates `permintaan_lab.tgl_sampel`/`jam_sampel` and resets the lab queue counter in `antrilabpk`. Only after this does "Hasil" open for that request. A request that already has a sample cannot be deleted except by "Admin Utama".
- **Tabel:** `permintaan_lab` (write), `antrilabpk` (write); `permintaan_pemeriksaan_lab`, `permintaan_detail_permintaan_lab` (read).

### 3. Enter PK results
- **Menu:** `A/Permintaan Lab PK` (form `DlgCariPermintaanLab`, opens `DlgPeriksaLaboratorium`)
- **Who:** Lab analyst with `periksa_lab`; the result form also requires a petugas, referring doctor, and doctor in charge.
- **Does:** With the sample recorded, click "Hasil", check the ordered tests, fill values per template, then Save. The form writes `periksa_lab` with `kategori='PK'` and `detail_periksa_lab`, posts the lab journal to `tampjurnal`, and for Ralan pushes the result queue (`antrilabpk2`).
- **Tabel:** `periksa_lab`, `detail_periksa_lab`, `tampjurnal`, `antrilabpk2` (write); `template_laboratorium`, `jns_perawatan_lab`, `set_akun_ralan`, `set_akun_ranap` (read).

### 4. Verify, correct, and print PK results
- **Menu:** `A/Periksa Lab PK` (form `DlgCariPeriksaLab`)
- **Who:** Lab supervisor with `periksa_lab`.
- **Does:** Browse results per visit, print model 1-12 or PDF, and fill "Kesan & Saran". "Ubah Nilai Hasil" corrects a value and "Ubah Periksa Lab" changes the tests. Delete removes `periksa_lab` + `detail_periksa_lab` only for `kategori='PK'` and reverses the journal — and is refused once billing exists.
- **Tabel:** `periksa_lab`, `detail_periksa_lab` (read/write), `saran_kesan_lab` (write), `tampjurnal` (write); `jns_perawatan_lab` (read).

### 5. PA line
- **Menu:** `A/Permintaan Lab PA` (form `DlgCariPermintaanLabPA`)
- **Who:** PA staff with `permintaan_lab` + `pemeriksaan_lab_pa`.
- **Does:** The PA request carries specimen details (how and where it was taken, fixation) and the PA result is free text: clinical diagnosis, macroscopic, microscopic, conclusion. "Sampel" writes the sample time to `permintaan_labpa`; "Hasil" opens `DlgPeriksaLaboratoriumPA`, which stores the result under `kategori='PA'`.
- **Tabel:** `permintaan_labpa` (read/write), `permintaan_pemeriksaan_labpa` (read), `periksa_lab`, `detail_periksa_labpa`, `detail_periksa_labpa_gambar` (write).

### 6. MB line
- **Menu:** `A/Permintaan Lab MB` (form `DlgCariPermintaanLabMB`)
- **Who:** Microbiology staff with `permintaan_lab` + `pemeriksaan_lab_mb`.
- **Does:** Same flow as PK but with its own request number and detail table. Results are written to the shared `periksa_lab`/`detail_periksa_lab` tables with `kategori='MB'`, so MB and PK results are only distinguishable by that column.
- **Tabel:** `permintaan_labmb`, `permintaan_pemeriksaan_labmb`, `permintaan_detail_permintaan_labmb` (read/write), `periksa_lab`, `detail_periksa_lab` (write).

### 7. Billing and payment
- **Menu:** `A/Rawat Jalan` (form `DlgKasirRalan`)
- **Who:** Cashier with `billing_ralan`.
- **Does:** The cashier loads the lab result into the bill. Outpatient charges go to `nota_jalan` + `detail_nota_jalan`, inpatient charges to `nota_inap` + `detail_nota_inap`, and `billing` stores the verified bill. Once that `billing` row exists, lab results can no longer be entered, changed, or deleted.
- **Tabel:** `billing`, `nota_jalan`, `nota_inap`, `detail_nota_jalan`, `detail_nota_inap` (write).

## Where it usually goes wrong
- **"Hasil" before "Sampel".** `DlgCariPermintaanLab` refuses with "Maaf, silahkan ambil sampel terlebih dahulu..!!" while `tgl_sampel`/`jam_sampel` are still `'0000-00-00'`/`'00:00:00'`. The order form inserts those zero values rather than NULL, so queries must test the zero date (the form itself does `IF(tgl_sampel='0000-00-00','',tgl_sampel)`).
- **A sampled request cannot be deleted.** "Hapus" answers "Maaf, Sudah dilakukan pengambilan sampel...!!" unless the login is "Admin Utama", and also refuses when any item already has `stts_bayar='Sudah'` ("...sudah ada tindakan yang sudah dibayar"). Cancel through the result/cashier side, not by deleting the request.
- **Billing freezes the result.** `DlgPeriksaLaboratorium` checks `Sequel.cariRegistrasi` (any `billing` row) and refuses with "Data billing sudah terverifikasi." Delete in `DlgCariPeriksaLab` has the same guard. The only bypass is a Ralan payer listed in `set_input_parsial`, which allows result entry after billing.
- **PK and MB share tables; PA does not.** `periksa_lab` and `detail_periksa_lab` hold both PK and MB rows, separated only by `kategori`. PA stores its details in `detail_periksa_labpa` (plus `detail_periksa_labpa_gambar`) while still using `periksa_lab` with `kategori='PA'`. A query without `kategori` mixes PK and MB, and deleting in "Periksa Lab PK" only touches `kategori='PK'`. Note also that one visit can hold several result sessions, located by `no_rawat` + `tgl_periksa` + `jam` (the delete query uses all three).

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `permintaan_lab` | 1, 2 | read/write |
| `permintaan_pemeriksaan_lab` | 1, 2 | read |
| `permintaan_detail_permintaan_lab` | 1, 2 | read |
| `reg_periksa`, `pasien`, `dokter`, `penjab` | 1 | read |
| `antrilabpk` | 2 | write |
| `periksa_lab` | 3, 4, 5, 6 | read/write |
| `detail_periksa_lab` | 3, 4, 6 | read/write |
| `tampjurnal` | 3, 4 | write |
| `antrilabpk2` | 3 | write |
| `template_laboratorium`, `jns_perawatan_lab` | 3, 4 | read |
| `set_akun_ralan`, `set_akun_ranap` | 3 | read |
| `saran_kesan_lab` | 4 | write |
| `permintaan_labpa` | 5 | read/write |
| `permintaan_pemeriksaan_labpa` | 5 | read |
| `detail_periksa_labpa`, `detail_periksa_labpa_gambar` | 5 | write |
| `permintaan_labmb` | 6 | read/write |
| `permintaan_pemeriksaan_labmb` | 6 | read |
| `permintaan_detail_permintaan_labmb` | 6 | read |
| `billing` | 7 | write |
| `nota_jalan`, `detail_nota_jalan` | 7 | write |
| `nota_inap`, `detail_nota_inap` | 7 | write |

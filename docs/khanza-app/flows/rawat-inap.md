```json meta
{
  "id": "rawat-inap",
  "title": "Permintaan rawat inap sampai pemulangan",
  "keywords": ["rawat inap", "ranap", "kamar", "bangsal", "pindah kamar", "pulang", "resume", "billing ranap", "cppt"],
  "menus": ["A/Permintaan Rawat Inap", "A/Rawat Inap", "A/Tindakan Ranap", "A/Beri Obat/BHP", "A/Resep Pulang", "M/Catatan Observasi Ranap", "M/Resume Pasien Ranap", "I/Pembayaran Ranap"],
  "forms": ["DlgPermintaanRanap", "DlgKamarInap", "DlgRawatInap", "DlgPemberianObat", "DlgResepPulang", "RMDataCatatanObservasiRanap", "RMDataResumePasienRanap", "DlgPembayaranRanap"]
}
```

# Permintaan rawat inap sampai pemulangan

An inpatient stay is requested from the poli or IGD in `A/Permintaan Rawat Inap`, becomes real when the ward checks the patient into a bed in `A/Rawat Inap`, is documented daily in `A/Tindakan Ranap`, summarised in the resume, billed by the cashier, and closed with a status pulang. The visit keeps the same `no_rawat` from registration to discharge; only `reg_periksa.status_lanjut` changes to `Ranap` when the bed is assigned.

## Steps

### 1. Request a bed
- **Menu:** `A/Permintaan Rawat Inap` (form `DlgPermintaanRanap`)
- **Who:** dokter poli or IGD, perawat
- **Does:** pick the visit, the bangsal and the kamar (room availability is shown by `A/Informasi Kamar`, right `informasi_kamar`), fill diagnosa (mandatory) and catatan, then **Simpan**. The form inserts `permintaan_ranap` and flips `kamar.status` to `DIBOOKING`, so the room cannot be promised twice from this screen. The default "Menunggu Masuk Rawat Inap" list hides visits that already have a `kamar_inap` row (switch to "Sudah Masuk Rawat Inap" to see those), and the form polls every second, sounding an alarm at second `:05` while new requests are waiting.
- **Hak akses:** `permintaan_ranap` enables Simpan/Hapus/Edit/Print; `kamar_inap` enables the button that jumps to the bed form; `surat_persetujuan_rawat_inap` and `bpjs_surat_pri` control the consent and PRI letters.
- **Tabel:** `permintaan_ranap` (insert), `kamar` (update `status`), `reg_periksa`, `pasien`, `bangsal`, `poliklinik`, `dokter` (read).

### 2. Check the patient in and assign the bed
- **Menu:** `A/Rawat Inap` (form `DlgKamarInap`)
- **Who:** perawat bangsal / admission
- **Does:** click **Masuk**, load the visit, choose the room, fill diagnosa awal (mandatory) and the tanggal/jam masuk, then **Simpan**. This inserts `kamar_inap` with `stts_pulang='-'` and `tgl_keluar='0000-00-00'`, updates `reg_periksa.status_lanjut='Ranap'` and sets `kamar.status='ISI'`. From now on the visit leaves the ralan cashier list and belongs to the ranap billing list. The room must be `KOSONG`; otherwise the form answers "Maaf, Status kamar sudah terisi silahkan pilih kamar kosong..!!!!".
- **Hak akses:** the menu appears when `kamar_inap`, `billing_ranap` or `tindakan_ranap` is true (`frmUtama` checks all three); **Simpan** and **Pindah** need `kamar_inap`. A non-`Admin Utama` user is restricted to the `KAMARAKTIFRANAP` bangsal.
- **Tabel:** `kamar_inap` (insert), `reg_periksa` (update `status_lanjut`), `kamar` (update `status`).

### 3. Document the daily visits (CPPT) and drugs
- **Menu:** `A/Tindakan Ranap` (form `DlgRawatInap`)
- **Who:** DPJP, perawat, bidan
- **Does:** the **Pemeriksaan** tab writes one `pemeriksaan_ranap` row per visit with vitals, keluhan, pemeriksaan, penilaian, tindak lanjut, instruksi and evaluasi. That row is what Khanza uses for the daily CPPT/visit note — no screen is literally named CPPT. The **Penanganan Dokter**, **Penanganan Petugas** and **Penanganan Dokter & Petugas** tabs add `rawat_inap_dr`, `rawat_inap_pr` and `rawat_inap_drpr`; **Obat/BHP** and **Input Obat** open the drug dialog with status `ranap`, writing `detail_pemberian_obat` plus `aturan_pakai` (`A/Beri Obat/BHP` opens the same form but without a visit context, so its entry dialog refuses with "Hanya bisa lewat Kasir Ralan atau Kamar Inap"). Nursing observations are in `M/Catatan Observasi Ranap` (`catatan_observasi_ranap`), the form also carries an **SBAR** tab for nurse consultation, and the attending doctor is set at `A/DPJP Ranap` (`dpjp_ranap`).
- **Hak akses:** `tindakan_ranap` for Simpan/Hapus/Edit/Print; `beri_obat` shows the drug buttons; `resume_pasien` / `data_resume_pasien` show the history and resume buttons. A `pemeriksaan_ranap` row can only be saved by the user whose kode equals the selected KdPeg, unless the user is `Admin Utama`.
- **Tabel:** `pemeriksaan_ranap` (insert), `rawat_inap_dr` / `rawat_inap_pr` / `rawat_inap_drpr` (insert), `detail_pemberian_obat` (insert), `aturan_pakai` (insert), `jns_perawatan_inap` (read).

### 4. Move the patient to another room
- **Menu:** `A/Rawat Inap` (form `DlgKamarInap`)
- **Who:** perawat bangsal
- **Does:** select the active row and click **Pindah**, then choose one of the four modes: (1) delete the old row and count the stay from now, (2) replace the room and rate on the old row, (3) close the old row with `stts_pulang='Pindah Kamar'`, fill `lama`/`ttl_biaya` and insert a new open row, (4) like 3 but the old row keeps the higher of the two room rates. In modes 3 and 4 the old row's `tgl_keluar`/`jam_keluar` hold the move time, and both rooms' `kamar.status` are updated (`KOSONG` / `ISI`).
- **Hak akses:** `kamar_inap`.
- **Tabel:** `kamar_inap` (update and insert), `kamar` (update `status`).

### 5. Write the resume
- **Menu:** `M/Resume Pasien Ranap` (form `RMDataResumePasienRanap`)
- **Who:** DPJP
- **Does:** also reachable with the resume button on `A/Rawat Inap` and `A/Tindakan Ranap` (right `data_resume_pasien`). The form preloads the last room row and its masuk/keluar times — when `tgl_keluar='0000-00-00'` it substitutes today's date and time — plus the diagnoses and procedures. **Simpan** requires dokter penanggung jawab, keluhan utama, jalannya penyakit and diagnosa utama, then writes one `resume_pasien_ranap` row (41 columns: history, lab, tindakan, drugs, primary and secondary diagnoses and procedures, allergies, diet, education, cara keluar, keadaan, kontrol, obat pulang).
- **Hak akses:** `data_resume_pasien` shows the menu and the resume button.
- **Tabel:** `resume_pasien_ranap` (insert), `kamar_inap`, `diagnosa_pasien`, `prosedur_pasien`, `reg_periksa`, `pasien`, `dokter`, `dpjp_ranap` (read).

### 6. Bill the stay
- **Menu:** `A/Rawat Inap` (form `DlgKamarInap`), context menu **Billing/Pembayaran Pasien**; take-home drugs are added first at `A/Resep Pulang` (form `DlgResepPulang`)
- **Who:** kasir / keuangan
- **Does:** room days come from the `kamar_inap` rows (an open row is charged to today), plus tindakan, drugs, lab, radiology and operations; the billing screen reads `resep_pulang`, so add take-home drugs before saving the nota. **Ubah Lama** edits the room row's dates and recalculates `ttl_biaya = lama * trf_kamar`, which changes the room history, not only the bill. **Simpan** writes `nota_inap`, one `billing` row per line, `detail_nota_inap` per akun bayar, `piutang_pasien` / `detail_piutang_pasien` when there is a remainder, and finally sets `reg_periksa.status_bayar='Sudah Bayar'`. If the patient still has an unpaid piutang, the screen asks whether to settle it first.
- **Hak akses:** `billing_ranap` enables the billing menu; `resep_pulang` enables the take-home drug entry.
- **Tabel:** `kamar_inap` (read; update through Ubah Lama), `nota_inap` (insert), `billing` (insert), `detail_nota_inap` (insert), `piutang_pasien` and `detail_piutang_pasien` (insert when there is a remainder), `reg_periksa` (update `status_bayar`), `resep_pulang` (read).

### 7. Discharge the patient and settle afterwards
- **Menu:** `A/Rawat Inap` (form `DlgKamarInap`); later settlement at `I/Pembayaran Ranap` (form `DlgPembayaranRanap`)
- **Who:** perawat bangsal, then kasir
- **Does:** select the active row and click **Pulang**; choose the status pulang (Sehat, Sembuh, Membaik, Rujuk, APS, Pulang Paksa, Meninggal, Atas Persetujuan Dokter, Atas Permintaan Sendiri, Isoman, Lain-lain), fill diagnosa akhir (both mandatory) and confirm. **Simpan** sets `tgl_keluar`, `jam_keluar`, `lama`, `ttl_biaya`, `stts_pulang` and `diagnosa_akhir` on that `kamar_inap` row and sets `kamar.status='KOSONG'`; `Meninggal` opens `M/Pasien Meninggal` and `Rujuk` opens `A/Rujukan Keluar`. After check-out, `I/Pembayaran Ranap` lists closed stays without a `piutang_pasien` row and reopens the billing screen for the selected patient, which is where a late or reprinted nota is finished.
- **Hak akses:** `kamar_inap`.
- **Tabel:** `kamar_inap` (update), `kamar` (update `status`), `piutang_pasien` and `nota_inap` (read at `I/Pembayaran Ranap`).

## Where it usually goes wrong

- **The room flag and the room history disagree.** Check-in and **Pindah** trust `kamar.status` only. Our Oct 2026 check found more rooms marked `ISI` than active stays (see `docs/khanza_notes.md`), so the screen can refuse a room that is really free ("Status kamar sudah terisi") or admit a second patient into an occupied one. Compare with `kamar_inap` rows where `stts_pulang='-'` before touching `kamar.status` by hand.
- **The wrong move mode rewrites the bill.** Mode 1 deletes the old room row, mode 2 overwrites its room and rate, and modes 3/4 keep the history with `stts_pulang='Pindah Kamar'`. Once the nota is saved the room rows stop being editable from the clinical side, so decide the mode with the cashier's rule instead of picking the first option.
- **Billing freezes the clinical side.** `Sequel.cariRegistrasi()` counts `billing` rows, so after the bill exists `A/Tindakan Ranap`, the drug dialog and **Data Tagihan/Tindakan Rawat Inap** refuse changes with "Data billing sudah terverifikasi". Use **Hapus data Nota Salah** in the billing screen (it reverses the journal, deletes `nota_inap`/`billing`/piutang and resets `status_bayar`) and re-bill.
- **Discharge documents can carry the wrong dates.** The resume falls back to today's date/time while `tgl_keluar='0000-00-00'`, and check-out only writes the real `tgl_keluar` when it is saved; picking "Pindah Kamar" in the checkout box closes the stay without opening a new room. Check the stay out (or enter the true date/time) before printing the resume.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `permintaan_ranap` | 1 | write (insert) |
| `kamar` | 1, 2, 4, 7 | write `status` (`DIBOOKING` → `ISI` → `KOSONG`) |
| `reg_periksa` | 1, 2, 6 | read (1, 6); write `status_lanjut` (2), `status_bayar` (6) |
| `kamar_inap` | 2, 4, 5, 6, 7 | write insert (2, 4), update (4, 6, 7); read (5, 6) |
| `pemeriksaan_ranap` | 3 | write (daily visit / CPPT row) |
| `rawat_inap_dr`, `rawat_inap_pr`, `rawat_inap_drpr` | 3 | write |
| `detail_pemberian_obat` | 3 | write |
| `aturan_pakai` | 3 | write |
| `jns_perawatan_inap` | 3 | read (tarif and names) |
| `catatan_observasi_ranap` | 3 | write at `M/Catatan Observasi Ranap` |
| `resume_pasien_ranap` | 5 | write |
| `diagnosa_pasien`, `prosedur_pasien` | 5 | read (prefill the resume) |
| `resep_pulang` | 6 | write at `A/Resep Pulang`; read by the billing screen |
| `nota_inap` | 6, 7 | write (6); read at `I/Pembayaran Ranap` (7) |
| `billing` | 6 | write |
| `detail_nota_inap` | 6 | write (per akun bayar, with PPN) |
| `piutang_pasien`, `detail_piutang_pasien` | 6, 7 | write when there is a remainder (6); read at `I/Pembayaran Ranap` (7) |
| `bangsal`, `pasien`, `dokter`, `dpjp_ranap`, `poliklinik`, `penjab` | 1, 2, 5 | read |

`permintaan_ranap` and `kamar` are written in the `DlgPermintaanRanap` source (`Sequel.menyimpantf`, `Sequel.mengedit`); `kamar` and `reg_periksa` are likewise updated in `DlgKamarInap`. The index picks both up (its write list includes the `Sequel.menyimpan*` / `Sequel.mengedit*` helpers). The billing tables are written by `DlgBilingRanap`, the screen opened from **Billing/Pembayaran Pasien** (it has no menu of its own), so `billing`, `nota_inap`, `detail_nota_inap`, `piutang_pasien` and `detail_piutang_pasien` do not appear under `DlgKamarInap` in the index.

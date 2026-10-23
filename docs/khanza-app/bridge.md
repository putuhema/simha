# Jembatan Simha ↔ aplikasi Khanza desktop

Simha tidak bisa mengubah data di Khanza. Yang bisa dilakukannya: **membuka form Khanza yang sudah
ada** untuk satu kunjungan, dan **mengisi draf** ke form resume (tanpa menyimpan). Semua lewat
`HarnessBridge.java`, satu kelas yang ditempel ke build Khanza rumah sakit.

Berkas: [`integrations/khanza-bridge/HarnessBridge.java`](../../integrations/khanza-bridge/HarnessBridge.java) ·
pemasang: [`apply.mjs`](../../integrations/khanza-bridge/apply.mjs) ·
sisi Simha: `apps/desktop/src/khanza-bridge.ts`.

## Cara kerjanya

1. `apply.mjs` menyalin `HarnessBridge.java` ke `src/simrskhanza/` dan menambahkan dua baris di
   `frmUtama.java`: `HarnessBridge.start()` setelah `akses.setData(...)` (login berhasil) dan
   `HarnessBridge.stop()` setelah `akses.setLogOut()`.
2. Setelah login, bridge mendengarkan di **127.0.0.1** pada port acak dan menulis `port`, token 48 hex,
   dan nama user ke `~/.simha/khanza-bridge.properties` (hanya bisa dibaca pemilik, `rw-------`).
   Build Khanza yang dipasangi sebelum ganti nama masih menulis ke `~/.simrs-harness/…`. Aplikasi desktop membaca keduanya, dan bridge baru menulis keduanya agar desktop lama tetap menemukannya.
3. Aplikasi desktop Simha membaca berkas itu, mengirim **satu baris** per koneksi, lalu menutupnya.
   Token dibandingkan constant-time; perintah lain ditolak.
4. Form dibuka di thread Swing seperti klik menu Khanza, lengkap dengan pemeriksaan hak Khanza sendiri.
   Kalau user tidak berhak, bridge menjawab `ERR` dan tidak membuka apa pun.

## Protokol

| Baris | Jawaban | Arti |
|---|---|---|
| `TOKEN \t ping` | `OK <user>` | bridge hidup dan sudah login |
| `TOKEN \t open \t FORM \t VALUE` | `OK` / `ERR <alasan>` | buka form untuk `VALUE` |
| `TOKEN \t fill \t resume_ranap \t NO_RAWAT \t key=base64;...` | `OK baru` / `OK ganti` / `ERR` | isi draf resume, tidak menyimpan |

`VALUE` untuk `open` adalah `no_rawat` (`2026/10/21/000002`), kecuali `riwayat` yang menerima
`no_rawat` atau `no_rkm_medis`.

## Form yang bisa dibuka

| Perintah | Form Khanza | Menu di aplikasi | Hak yang dicek |
|---|---|---|---|
| `resume_ranap` | `RMDataResumePasienRanap` | M/Resume Pasien Ranap | `data_resume_pasien` |
| `resume_ralan` | `RMDataResumePasien` | M/Resume Pasien Ralan | `data_resume_pasien` |
| `soap_ranap` | `DlgRawatInap` (tab CPPT/SOAP) | A/Tindakan Ranap | `tindakan_ranap` |
| `soap_ralan` | `DlgRawatJalan` (tab CPPT/SOAP) | A/Tindakan Ralan | `tindakan_ralan` |
| `riwayat` | `RMRiwayatPerawatan` | M/Riwayat Perawatan | cukup login + pasien ada |
| `resume` / `soap` | pilih ranap/ralan dari `reg_periksa.status_lanjut` | salah satu di atas | sama |

Peta menu lengkapnya ada di [menu/M.md](menu/M.md) dan [menu/A.md](menu/A.md); form dan tabelnya di
[forms/rekammedis.md](forms/rekammedis.md) dan [forms/simrskhanza.md](forms/simrskhanza.md).

## Isi draf resume (`fill`)

- Hanya untuk `resume_ranap`.
- 39 kolom `resume_pasien_ranap` dipetakan ke field form (`diagnosa_awal` → `DiagnosaAwal`,
  `pemeriksaan_penunjang` → `PemeriksaanRad`, dan seterusnya). Nilai dikirim base64 dalam satu baris.
- Kalau resume untuk kunjungan itu sudah ada, bridge memilih barisnya dulu (setara klik baris) supaya
  tombol **Ganti** bekerja; kalau belum ada, form kosong untuk **Simpan**.
- Bridge **tidak pernah menekan Simpan/Ganti**. User memeriksa dan menyimpan sendiri di Khanza.

## Kalau bridge tidak menjawab

Simha jatuh ke mode lama: jendela Khanza yang sedang berjalan difokuskan (PowerShell mencari proses
`java`/`javaw` berjudul `Khanza|^SIM `), lalu nomor kunjungan disalin ke clipboard untuk ditempel.
Penyebab umum: Khanza belum login, build Khanza belum dipasangi bridge (atau baru saja di-update),
aplikasi Khanza tidak berjalan, atau berkas `khanza-bridge.properties` sudah dihapus saat logout.

## Batas

- Hanya lima form di atas. Billing ranap/ralan dan SEP belum didukung karena Khanza menjalankan
  prompt dan logika depo tambahan sebelum membukanya.
- Bridge harus dipasang ulang setelah setiap update Khanza: `node integrations/khanza-bridge/apply.mjs <folder-khanza>`,
  lalu build ulang di NetBeans (Clean and Build).
- Bridge hanya mendengarkan loopback; tidak ada koneksi keluar dan tidak ada data pasien yang dikirim
  ke Simha — Simha hanya mengirim perintah dan nomor kunjungan (plus isi draf saat `fill`).

# Cara membaca menu Khanza

## Tiga lapis navigasi

1. **Toolbar atas** (akses cepat): Menu, Registrasi, IGD/UGD, Laborat, Radiologi, Farmasi, Rawat Inap,
   Rawat Jalan, Operasi, Log Out, Keluar. Ini yang paling cepat untuk membuka form utama.
2. **Grid Menu** (grup A–T): semua form, termasuk yang tidak ada di toolbar.
3. **Klik kanan baris pasien** di dalam daftar (Rawat Inap, Rawat Jalan, Registrasi): **ini yang paling
   sering dipakai perawat**, dan yang harus disebut lebih dulu. Menu konteks berisi
   **Billing/Pembayaran Pasien**, **Obat → Input Resep Pulang / Data Pemberian Obat/BHP**, **Deposit**,
   **Laporan & Surat**, dan submenu rekam medis. Banyak pekerjaan (billing, resep pulang, pemberian obat,
   resume, permintaan lab/radiologi, surat) hanya ada di sini, bukan di grid Menu.
   Urutan jawaban: **klik kanan dulu**, lalu toolbar/menu hanya sebagai alternatif.

Contoh: untuk billing rawat inap → buka **Rawat Inap** (toolbar), pilih pasien, klik kanan →
**Billing/Pembayaran Pasien**. Bukan tombol Cetak.

Di aplikasi desktop, klik tombol **Menu** di kiri atas. Muncul dialog dengan dropdown:

**Tampilkan Menu :** `[A] Registrasi, ...` — pilih satu, lalu klik tombol di grid.

Huruf `A`–`T` itu **hanya kode grup**, bukan nama menu. Saat menjelaskan ke user, sebut namanya:

| Kode | Nama grup | Isi singkat |
|---|---|---|
| A | Registrasi & Billing | registrasi, IGD, tindakan ralan/ranap, kamar inap, kasir |
| B | Barcode | input tindakan/obat lewat scan no. rawat |
| C | Kepegawaian | petugas, dokter, presensi, gaji |
| D | Inventory Obat | obat/BHP, stok, pembelian, retur |
| E | Inventory Non-Medis | barang non-medis, lab & radiologi |
| F | Dapur | barang dapur, gizi |
| G | Aset & IPSRS | inventaris, aset, pemeliharaan |
| H | Parkir | jenis parkir, parkir masuk/keluar |
| I | Tagihan & Rekap | harian dokter/kamar, pembayaran, piutang |
| J | Penyakit & Laporan | ICD, RL, surveilans, sensus |
| K | Tarif & Keuangan | tarif, akun, deposit, piutang, klaim |
| L | Bridging BPJS | VClaim, SEP, surat kontrol, INACBG, antrean |
| M | Rekam Medis | pasien, dokter, resume, CPPT, surat medis |
| N | UTD | donor, stok darah, penyerahan |
| O | Analisa & Grafik | dashboard dan grafik kunjungan |
| P | Surat | surat sakit, sehat, bebas narkoba/TBC, dll. |
| Q | Perpustakaan | koleksi, peminjaman |
| R | Toko | koperasi/minimarket |
| S | Filantropi | zakat, infaq, CSR |
| T | Pengaturan | set aplikasi, set user, harga, vakum |

## Bentuk path menu

`Menu → Rekam Medis → Resume Pasien Ranap` berarti:

1. klik **Menu**,
2. pilih grup **Rekam Medis** (kode `M`) di dropdown,
3. klik tombol **Resume Pasien Ranap**.

Path lengkap di `index.json` ditulis `M/Resume Pasien Ranap`; huruf itu hanya untuk mesin dan untuk
mencocokkan dengan source, bukan untuk diucapkan ke user.

## Judul dialog vs nama kelas

Setelah tombol diklik, jendela yang terbuka punya **judul** yang terlihat, misalnya:

- `Data Resume Medis Pasien Rawat Inap` (kelas `RMDataResumePasienRanap`)
- `Detail Pemberian Obat/Barang/Alkes/Perlengkapan` (kelas `DlgPemberianObat`)
- `Data Surat Keterangan Bebas Narkoba` (kelas `SuratBebasNarkoba`)

Sebut judulnya. Nama kelas Java hanya berguna untuk teknisi yang mencari file di source
(`forms/*.md` mencantumkan keduanya).

## Tombol di dalam dialog

`forms/*.md` dan `index.json` (`forms[].actions`) mencatat tombol di dalam form: **Simpan**, **Ganti**,
**Cetak**, **Pindah**, **Masuk**, **Pulang**, dan seterusnya. Contoh: pindah kamar = buka
`A/Rawat Inap` → klik **Pindah**.

## Tabel yang disentuh form

`index.json` juga mencatat tabel per form: `forms[].tables.write` (INSERT/UPDATE/DELETE) dan
`forms[].tables.read` (SELECT/JOIN). Ini petunjuk statis dari SQL di source, bukan jaminan runtime.
Pertanyaan seperti "form apa yang mengisi `kamar_inap`" dijawab `cariAplikasiKhanza` dengan
`bagian: "tabel"`; field `form[].tulis`/`baca` dan `tabel[].tulis`/`baca` menunjukkan form yang menulis
atau hanya membaca tabel itu.

# Menu peta (SIMRS Khanza desktop)

Generated from commit `2e695e7` by `pnpm extract-khanza-app`. Do not edit by hand.

The app opens `DlgHome` from the **Menu** button; `cmbMenu` picks a group [A]–[T], and the grid shows the buttons
the logged-in user may use. One row here = one button in one group.

| Group | Arti | Tombol |
|---|---|---|
| [A](menu/A.md) | Registrasi, Tagihan Ranap & Ralan, Pelayanan & Billing Pasien | 33 |
| [B](menu/B.md) | Input Data Tindakan, Obat & BHP Via Barcode No.Rawat | 2 |
| [C](menu/C.md) | Presensi, Manajemen & Penggajian Pegawai Rumah Sakit | 60 |
| [D](menu/D.md) | Transaksi Inventory Obat, BHP Medis, Alat Kesehatan Pasien | 75 |
| [E](menu/E.md) | Transaksi Inventory Barang Non Medis, Penunjang ( Lab & RO ) | 33 |
| [F](menu/F.md) | Transaksi Inventory Barang Dapur Kering & Basah | 27 |
| [G](menu/G.md) | Aset, Inventaris Barang & Instalasi Kesehatan Lingkungan | 27 |
| [H](menu/H.md) | Menejemen Parkir Kendaraan Pasien & Karyawan | 3 |
| [I](menu/I.md) | Olah Data Tagihan Rawat Inap & Rawat Jalan | 57 |
| [J](menu/J.md) | Olah Data Penyakit, Laporan DKK, Laporal RL & Laporan Internal | 92 |
| [K](menu/K.md) | Tarif Pelayanan, Menejemen Keuangan & Akuntansi | 76 |
| [L](menu/L.md) | Bridging VClaim, Aplicare, PCare, INACBG, Kemenkes & Pihak Ke 3 | 168 |
| [M](menu/M.md) | Olah Data Rekam Medis Pasien | 198 |
| [N](menu/N.md) | Unit Pelayanan Tranfusi Darah | 11 |
| [O](menu/O.md) | Analisa, Dashboard & Info Grafik | 113 |
| [P](menu/P.md) | Manajemen Surat Masuk & Keluar, Pengumuman E-Pasien | 34 |
| [Q](menu/Q.md) | Manajemen Perpustakaan & Koleksi Pustaka Digital | 16 |
| [R](menu/R.md) | Toko / Minimarket / Koperasi | 25 |
| [S](menu/S.md) | Pengelolaan Data Filantropi, CSR, Zakat, Infaq & Shodaqoh | 16 |
| [T](menu/T.md) | Pengaturan Program Aplikasi HMS | 28 |

Kolom **Hak** = hak akses yang harus dimiliki user (kolom boolean di tabel `user`); salah satu cukup.
Kolom **Tabel** = tabel yang disebut form itu di SQL-nya (tulis **tebal**, baca biasa) — petunjuk, bukan jaminan.

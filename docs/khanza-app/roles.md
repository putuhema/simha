# Hak akses (roles) di SIMRS Khanza

Khanza tidak punya "role" seperti RBAC: setiap hak adalah **satu kolom boolean di tabel `user`**, dan
hampir setiap tombol menu punya kolomnya sendiri. Menu yang tidak diizinkan **tidak ditambahkan sama
sekali** — bukan abu-abu, memang tidak ada.

## Dari login ke menu

1. `frmUtama` memanggil `akses.setData(user, pass)`.
2. Baris di tabel **`admin`** cocok → `akses.kode = "Admin Utama"` dan **semua** hak di-set `true`.
3. Kalau tidak, baris di tabel **`user`** cocok → setiap kolom boolean dibaca dengan
   `rs2.getBoolean("registrasi")`, `getBoolean("tindakan_ralan")`, dan seterusnya.
4. `DlgHome` → `isCombo()` memeriksa hak per blok `if`, lalu menambahkan tombolnya ke grid.
5. Form yang terbuka memanggil `isCek()` / `isCek2()` dan mengaktifkan tombol di dalamnya menurut hak
   yang sama (mis. `DlgReg` mengaktifkan Simpan/Hapus hanya dengan `registrasi`).

Kredensial disimpan terenkripsi: query login memakai `AES_ENCRYPT(?,'nur')` untuk `admin.usere` /
`user.id_user` dan `'windi'` untuk password. Jangan menulis user/password langsung dengan `INSERT`/`UPDATE`;
pakai menu **T/Set User** (atau **T/Set Admin**) di aplikasi.

## Angka

- `src/fungsi/akses.java` punya **1.109** flag boolean (termasuk flag internal seperti `aktif`, `admin`, `user`).
- **1.072** hak muncul di peta menu; **1.052** di antaranya menggerbangi tepat satu tombol.
- Hanya **12** tombol digerbangi lebih dari satu hak (satu blok `if` yang menambahkan beberapa tombol,
  mis. tiga tombol Permintaan Lab memakai satu blok hak yang sama).
- **8** tombol tidak memakai hak sama sekali (selalu tampil setelah login): Rekap Kehadiran,
  Rekap Kehadiran 2, tiga aksi "Kirim … Satu Sehat" (`Kirim Q.R. Telaah Farmasi`, `Kirim Allergy
  Intolerance`, `Kirim Image Study`), `Koleksi Penelitian`, `Cari Koleksi Ebook`,
  `Cari Inventaris Perpustakaan`.

## Hak yang sering ditanyakan

| Hak (`user` column) | Membuka |
|---|---|
| `registrasi` | A/Registrasi (`DlgReg`) |
| `tindakan_ralan` | A/Tindakan Ralan (`DlgRawatJalan`) + SOAP ralan di bridge |
| `tindakan_ranap` | A/Tindakan Ranap (`DlgRawatInap`) + SOAP ranap di bridge |
| `kamar_inap` | A/Rawat Inap (`DlgKamarInap`) |
| `billing_ralan` | A/Rawat Jalan (`DlgKasirRalan`) |
| `billing_ranap` | billing di dalam `DlgKamarInap` / `DlgBilingRanap` |
| `igd` | A/IGD/UGD (`DlgIGD`) |
| `permintaan_lab` | A/Permintaan Lab PK/PA/MB |
| `periksa_lab` | A/Periksa Lab PK |
| `periksa_radiologi` | A/Periksa Radiologi |
| `resep_obat` | A/No. Resep (`DlgResepObat`) |
| `beri_obat` | A/Beri Obat/BHP (`DlgPemberianObat`) |
| `resep_pulang` | A/Resep Pulang |
| `deposit_pasien` | K/Deposit Pasien |
| `piutang_pasien` | K/Piutang Pasien |
| `data_resume_pasien` | M/Resume Pasien Ranap & Ralan (**wajib** untuk bridge `resume`) |
| `kasir_ralan` | pembayaran di kasir ralan |

Daftar lengkap hak → menu ada di [index.json](index.json) (`rights`), dan hak per tombol di
[menu/](menu/README.md).

## "Menu saya tidak muncul" — urutan periksa

1. **Hak di `user`**: `SELECT registrasi, tindakan_ralan, ... FROM user WHERE ...`. Kolom yang dipakai
   menu ini 0/NULL? Lihat kolom **Hak** di [menu/](menu/README.md).
2. **Salah grup**: tombol hanya ada di grupnya sendiri. Rawat inap ada di **A**, bukan **M**; tarif di
   **K**; bridging BPJS di **L**; laporan di **I/J/O**. Peta grup: [menu/README.md](menu/README.md).
3. **Login sebagai siapa**: akun `admin` selalu melihat semua; akun `user` hanya kolomnya.
4. **Sudah login sebelum hak diubah**: `akses` dibaca sekali saat login. Logout lalu login lagi.
5. **Form mengecek hak kedua**: menu muncul, tetapi tombol di dalam form mati karena `isCek()` meminta
   hak lain (contoh: menu Resume muncul tanpa `data_resume_pasien`, tetapi simpan/isi tidak jalan).
6. **Bukan masalah hak**: tiga tombol INACBG (`btnInaCBGKlaimBaruOtomatis/Manual/Manual2`) membuka
   panel web PHP, bukan form desktop; `btnfee_rujukan_ranap` handler-nya masih `// TODO`.

## Catatan untuk harness

Agent tidak boleh mengubah hak sendiri. Kalau perbaikan data menyentuh menu/hak, jawab dengan menu
yang harus dibuka IT (mis. **T/Set User**) dan jelaskan kolom yang perlu di-set — jangan menulis
`UPDATE user` dengan password terenkripsi.

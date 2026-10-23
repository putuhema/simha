# Peta aplikasi SIMRS Khanza (desktop)

Sumber: `~/work/simrsmt`, commit `2e695e7`, dibuat 2026-10-23.
Dibuat ulang oleh `pnpm extract-khanza-app`; jangan diedit tangan.

Berkas ini yang dipakai agent lewat tool `cariAplikasiKhanza`.

## Isi

- [menu/](menu/README.md) — 20 grup menu [A]–[T], tombol, hak akses, form.
- [forms/](forms/README.md) — form per paket: tombol di dalam form, hak, tabel yang dibaca/ditulis.
- [cara-pakai.md](cara-pakai.md) — arti grup A–T, path menu, dan judul dialog.
- [flows/](flows/README.md) — alur pasien dan data (registrasi, ranap, lab, farmasi, kasir, BPJS, ...).
- [roles.md](roles.md) — cara hak akses bekerja dan kenapa menu tidak muncul.
- [bridge.md](bridge.md) — cara Simha membuka form di aplikasi desktop.
- [synonyms.json](synonyms.json) — kata yang dipakai staf tetapi tidak ada di label menu (mis. "pindah kamar").
- [index.json](index.json) — graf lengkap untuk mesin (menu, form, hak, tabel).

## Angka

- 20 grup menu, 1094 tombol (1094 berlabel sendiri).
- 1090 tombol menunjuk ke form yang dikenal; 1079 form unik.
- 1026 tabel di `sik.sql` dipakai sebagai daftar nama tabel yang sah.
- 8 tombol toolbar dan 2191 item klik kanan.

## Paket form

| Paket | Form |
|---|---|
| bridging | 166 |
| dapur | 25 |
| grafikanalisa | 112 |
| informasi | 1 |
| inventaris | 27 |
| inventory | 79 |
| ipsrs | 32 |
| kepegawaian | 60 |
| keuangan | 132 |
| laporan | 100 |
| parkir | 3 |
| permintaan | 11 |
| perpustakaan | 16 |
| rekammedis | 172 |
| setting | 28 |
| simrskhanza | 32 |
| smsui | 1 |
| surat | 34 |
| toko | 22 |
| tranfusidarah | 9 |
| viabarcode | 2 |
| ziscsr | 15 |

## Cara membaca

Menu di aplikasi: klik **Menu** → pilih grup di `cmbMenu` → klik tombol. Urutan itu yang ditulis
sebagai `A/Registrasi`, `B/…` dan seterusnya. Hak akses adalah kolom boolean di tabel `user`;
user dengan hak itu saja yang melihat tombolnya.

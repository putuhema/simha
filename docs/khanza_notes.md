# Khanza notes

What the tables and codes mean **in our hospital**. Maintained by hand by IT.

The agent's `lihatSkema` tool reads this file together with `docs/schema.md` before it writes any SQL, so short, factual lines work best. Use one bullet per fact. Write in English or Indonesian, whichever is clearer.

## Tables

- `reg_periksa` = one row per visit/registration. `no_rawat` is the visit ID, `no_rkm_medis` the patient (RM).
- `reg_periksa.status_lanjut`: `Ralan` = rawat jalan (outpatient), `Ranap` = rawat inap (inpatient).
- `kamar_inap` = room history of an inpatient stay. The current room is the row with `stts_pulang = '-'`; its `tgl_keluar` is `'0000-00-00'` (never NULL in our data). A room move closes the old row with `stts_pulang = 'Pindah Kamar'` and adds a new row. (Checked on our DB, Oct 2026.)
- `kamar.status` (`ISI`/`KOSONG`/`DIBERSIHKAN`/`DIBOOKING`) is not always in sync with `kamar_inap`: in Oct 2026 there were more rooms marked `ISI` than active stays. Always compare with the active `kamar_inap` rows.
- Tindakan are in six tables: `rawat_jl_dr`, `rawat_jl_pr`, `rawat_jl_drpr` (outpatient) and `rawat_inap_dr`, `rawat_inap_pr`, `rawat_inap_drpr` (inpatient). Most rows are in the `_drpr` tables. Names come from `jns_perawatan` (outpatient) and `jns_perawatan_inap` (inpatient).
- `nota_jalan` / `nota_inap`: one row per `no_rawat` once the bill is made.
- `detail_pemberian_obat` = drugs given to patients; join `databarang` on `kode_brng` for names.
- TODO: add more.

## Codes

- `status = '1'` means active in `poliklinik`, `penjab`, `bangsal` and `dokter`; old codes stay with `status = '0'`.
- Poli gigi: `kd_poli = 'U0010'` ("Poliklinik Gigi & Mulut").
- Payer (`kd_pj` in `reg_periksa` and `pasien`): BPJS = `BPJ` ("BPJS KESEHATAN"); umum = `A09` ("UMUM"). Old inactive BPJS codes: `A65`, `A28` (BPJS MANDIRI). For "BPJS vs umum" group by `kd_pj` and join `penjab` for the name.
- Melati wards: the active ones are `kls21`–`kls25` ("Per. Kelas 2 (Melati 1)" … "(Melati 5)"); `B0024`, `B0056`, `B0072`–`B0074`, `B0086` and `kls2` are inactive old codes. Mawar: `MW` (inactive). Search `bangsal.nm_bangsal` with LIKE when a ward name is mentioned.
- Drugs given: `detail_pemberian_obat.jml` is the quantity, `tgl_perawatan` the date, `status` `Ralan`/`Ranap`; drug name is `databarang.nama_brng`.
(Codes checked on our DB, Oct 2026.)

## Aplikasi (menu & alur)

- Menu desktop: klik **Menu**, pilih grup `[A]`–`[T]` di `cmbMenu`, lalu klik tombolnya. Huruf itu hanya kode grup — sebut namanya (A Registrasi & Billing, M Rekam Medis, P Surat, K Tarif & Keuangan). Peta lengkap: `docs/khanza-app/` (tool `cariAplikasiKhanza`).
- Judul dialog (mis. "Data Resume Medis Pasien Rawat Inap") adalah yang terlihat di jendela; nama kelas Java seperti `RMDataResumePasienRanap` hanya untuk teknisi.
- Navigasi punya tiga lapis: toolbar atas (Registrasi, IGD/UGD, Laborat, Radiologi, Farmasi, Rawat Inap, Rawat Jalan, Operasi), grid Menu A–T, lalu klik kanan baris pasien di daftar.
- Billing dan resep pulang hanya ada di klik kanan: **Billing/Pembayaran Pasien**, **Obat → Input Resep Pulang**, **Obat → Data Pemberian Obat/BHP**. Bukan tombol Cetak.
- Hak akses = kolom boolean di tabel `user` (login `admin` = semua hak). Tombol yang tidak diizinkan tidak ditambahkan ke grid, jadi "menu hilang" hampir selalu hak di `user` atau user perlu login ulang.
- Pindah kamar dan pulang: menu `A/Rawat Inap` (`DlgKamarInap`), bukan dari form registrasi.
- Resume medis: `M/Resume Pasien Ranap`; CPPT/SOAP ada di dalam `A/Tindakan Ranap` / `A/Tindakan Ralan`.
- "Form apa yang mengisi tabel X" dijawab `cariAplikasiKhanza` (`bagian: "tabel"`): `form[].tulis` = tabel yang ditulis form itu, `form[].baca` = hanya dibaca. Ini petunjuk statis dari SQL form, bukan jaminan runtime.
- Langkah alur, tombol, hak, dan pesan peringatan yang lengkap dibaca dengan `detailAplikasi` (id dari `cariAplikasiKhanza`). Judul langkah saja tidak cukup untuk menjelaskan alur.

## Local schema changes

List columns or tables we added or changed compared to standard Khanza.

- TODO

## Common problems and their usual fix

- "Tidak bisa pindah kamar": TODO
- "Surat kontrol BPJS gagal": TODO

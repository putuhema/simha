# Alur (flows) SIMRS Khanza

Alur ditulis tangan dari source aplikasi (commit `2e695e7`) dan dari perilaku form-nya — bukan dari
database. Peta menu/form yang dihasilkan ada di [../index.json](../index.json); alur ini yang menjelaskan
**urutan** dan **titik data**-nya.

Setiap berkas dimulai dengan blok `json meta` (dibaca tool `cariAplikasiKhanza`), lalu:

- `### langkah` dengan baris **Menu:** (nama form biasanya ditulis (form `X`) di baris yang sama) dan **Tabel:** — supaya bisa dicari per langkah;
- bagian **Where it usually goes wrong** — jebakan yang benar-benar ada di kode (validasi, hak, status billing);
- tabel ringkas tabel database yang tersentuh.

| Alur | Mulai | Selesai | Berkas |
|---|---|---|---|
| Registrasi rawat jalan | `A/Registrasi` | `nota_jalan` + `status_bayar` | [registrasi-ralan.md](registrasi-ralan.md) |
| Rawat inap | `A/Permintaan Rawat Inap` | `kamar_inap` ditutup + billing ranap | [rawat-inap.md](rawat-inap.md) |
| IGD | `A/IGD/UGD` | pasien pulang / dirawat / dirujuk | [igd.md](igd.md) |
| Laboratorium | `A/Permintaan Lab PK` | hasil diverifikasi + billing | [laboratorium.md](laboratorium.md) |
| Radiologi | `A/Permintaan Radiologi` | hasil bacaan + billing | [radiologi.md](radiologi.md) |
| Farmasi | `A/No. Resep` | obat diserahkan + stok turun | [farmasi.md](farmasi.md) |
| Kasir & billing | `A/Rawat Jalan` / `A/Rawat Inap` | nota lunas / piutang | [kasir-billing.md](kasir-billing.md) |
| Bridging BPJS | `L/Data Bridging SEP VClaim` | SEP, surat kontrol, klaim | [bridging-bpjs.md](bridging-bpjs.md) |
| Master data & tarif | `K/*`, `M/*` | tarif dan master siap dipakai | [master-tarif.md](master-tarif.md) |
| Laporan | `I/*`, `J/*`, `O/*` | rekap & RL | [laporan.md](laporan.md) |

## Cara membaca path menu

`A/Rawat Inap` = klik **Menu** → pilih grup **A** di `cmbMenu` → klik tombol **Rawat Inap**.
Grup lengkap: [../menu/README.md](../menu/README.md). Hak yang menggerbangi tombol ada di kolom **Hak**;
model hak akses dijelaskan di [../roles.md](../roles.md).

## Mengubah alur

Ubah `.md`-nya langsung (bukan `index.json`). Kalau menu atau form berubah karena update Khanza, jalankan
`pnpm extract-khanza-app` lalu periksa path di blok `meta` dan baris **Menu:** — path lama akan gagal
ditemukan di peta baru.

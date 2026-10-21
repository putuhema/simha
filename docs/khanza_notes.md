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

- `kd_poli` for poli gigi is `TODO` (check `poliklinik`).
- `kd_pj` for BPJS is `TODO`, for umum is `TODO` (check `penjab`).
- Ward names: Melati = `kd_bangsal` `TODO`, Mawar = `TODO`.

## Local schema changes

List columns or tables we added or changed compared to standard Khanza.

- TODO

## Common problems and their usual fix

- "Tidak bisa pindah kamar": TODO
- "Surat kontrol BPJS gagal": TODO

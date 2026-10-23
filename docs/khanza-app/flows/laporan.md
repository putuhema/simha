```json meta
{
  "id": "laporan",
  "title": "Laporan, rekap, dan dashboard",
  "keywords": ["laporan", "rekap", "tagihan", "RL", "morbiditas", "dashboard", "grafik", "penyakit", "kunjungan"],
  "menus": ["I/Harian Dokter Poli", "I/Harian Dokter Ralan", "I/Obat Per Poli", "I/Harian Kamar", "J/Rekap Kunjungan", "J/RL 4A Morbiditas Ranap", "J/RL 4B Morbiditas Ralan", "J/RL 3.2 Rawat Darurat", "J/ICD 10", "O/Registrasi Per Poli"],
  "forms": ["DlgRBTindakanPoli", "DlgRBTindakanKamar", "DlgRekapKunjungan", "DlgRL4A", "DlgRL4B", "DlgRl32", "DlgPenyakit", "GrafikRegistrasiPoli"]
}
```

# Laporan, rekap, dan dashboard

Reports are grouped by purpose: **I** for tagihan/payment recaps, **J** for diseases, RL forms and
internal reports, **O** for charts. None of them has a reporting copy of the data: every form
`SELECT`s the same `reg_periksa`, `rawat_jl_*`, `kamar_inap` and `diagnosa_pasien` rows that data
entry writes. The only database writes go to the scratch table `temporary` (Jasper reports, keyed
by client IP); several J reports instead write an HTML file into the working directory and open it in
the browser. Read-only was verified in `DlgRBTindakanPoli`, `DlgRBTindakanKamar`,
`DlgRekapKunjungan`, `DlgRL4A`, `DlgRL4B`, `DlgRl32` and `GrafikRegistrasiPoli`; transaction tables
are only read.

## Steps

### 1. Recap billing per doctor and poli
- **Menu:** `I/Harian Dokter Poli` (form `DlgRBTindakanPoli`); `I/Harian Dokter Ralan` and `I/Obat Per Poli` are separate buttons for adjacent cuts.
- **Who:** finance / casemix with `harian_tindakan_poli`.
- **Does:** pick a poli and date range; one row per doctor with visit count and sums for doctor actions (`rawat_jl_dr`, `rawat_jl_drpr`), drugs, lab, radiology, `tambahan_biaya` and `pengurangan_biaya`. **Cetak** copies the grid into `temporary` (rows tagged with the client IP) and fills `rptRBTindakanPoli.jasper`.
- **Tabel:** reads `reg_periksa`, `rawat_jl_dr`, `rawat_jl_drpr`, `detail_pemberian_obat`, `tagihan_obat_langsung`, `periksa_lab`, `detail_periksa_lab`, `periksa_radiologi`, `tambahan_biaya`, `pengurangan_biaya`, `kamar_inap`, `dokter`, `poliklinik`, `penjab`, `pasien`, `setting`; writes `temporary`.

### 2. Recap billing per ward
- **Menu:** `I/Harian Kamar` (form `DlgRBTindakanKamar`)
- **Who:** finance or ward admin with `harian_kamar`.
- **Does:** per bangsal, lists patients whose `kamar_inap.tgl_keluar` falls in the range, skipping `stts_pulang='Pindah Kamar'` rows, and sums the bed charge plus inpatient actions, drugs, lab, radiology and operations. It prints the same way as step 1, through `temporary` and a Jasper template.
- **Tabel:** reads `kamar_inap`, `kamar`, `bangsal`, `rawat_inap_dr`, `rawat_inap_drpr`, `rawat_inap_pr`, `operasi`, `detail_pemberian_obat`, `detail_periksa_lab`, `periksa_lab`, `periksa_radiologi`, `tambahan_biaya`, `pengurangan_biaya`, `tagihan_obat_langsung`, `reg_periksa`, `pasien`, `penjab`, `setting`; writes `temporary`.

### 3. Count registrations for the year
- **Menu:** `J/Rekap Kunjungan` (form `DlgRekapKunjungan`)
- **Who:** management or medical records with `rekap_kunjungan`.
- **Does:** choose a year and get a twelve-month HTML table split male/female, new/old, `Ralan`/`Ranap`, with extra columns for polis whose name matches `poliklinik.nm_poli like '%jiwa%'`; cancelled registrations (`stts='Batal'`) are excluded. **Cetak** writes `rekapkunjungan.html` plus `file2.css` into the working directory and opens it in the browser — no Jasper and no table write.
- **Tabel:** reads `reg_periksa`, `pasien`, `poliklinik`; no database write.

### 4. Produce RL 4A / 4B morbidity
- **Menu:** `J/RL 4A Morbiditas Ranap` (form `DlgRL4A`) and `J/RL 4B Morbiditas Ralan` (form `DlgRL4B`); the ICD-10 codes come from `J/ICD 10` (form `DlgPenyakit`).
- **Who:** casemix or medical records with `rl4a` / `rl4b`; editing the dictionary needs `penyakit`.
- **Does:** groups `diagnosa_pasien` by `kd_penyakit` into age/sex bands and counts deaths by joining `pasien_mati` on the RM number. RL 4A has two tabs: `Berdasar Tanggal Masuk` filters `reg_periksa.tgl_registrasi`, `Berdasar Tanggal Keluar` filters `kamar_inap.tgl_keluar` and `prioritas='1'`. RL 4B keeps `status='Ralan'` plus `status_penyakit='Baru'`. Output is `rl4a.html` / `rl4b.html` opened in the browser.
- **Tabel:** reads `diagnosa_pasien`, `penyakit`, `reg_periksa`, `pasien`, `pasien_mati`, `kamar_inap`, `dokter`, `penjab`, `poliklinik`, `kabupaten`, `kecamatan`, `kelurahan`; no database write.

### 5. Produce RL 3.2 rawat darurat
- **Menu:** `J/RL 3.2 Rawat Darurat` (form `DlgRl32`)
- **Who:** IGD or medical records with `rl32`.
- **Does:** per poli, counts referrals in (`rujuk_masuk`), non-referrals, patients admitted (`kamar_inap`), referrals out (`rujuk`), "pulang" and "mati IGD" (`pasien_mati`). **Cetak** writes `temporary` and fills `rptRl32.jasper`; all counters use `tgl_registrasi`, not the stay or death date.
- **Tabel:** reads `reg_periksa`, `poliklinik`, `rujuk_masuk`, `rujuk`, `kamar_inap`, `pasien_mati`, `setting`; writes `temporary`.

### 6. Look at the O charts
- **Menu:** `O/Registrasi Per Poli` (form `GrafikRegistrasiPoli`); the other O buttons are the same pattern for year/month/day, doctor, payer and ward.
- **Who:** management with `grafik_kunjungan_poli`.
- **Does:** choose a date range, press a bar or pie button, and the form aggregates `reg_periksa` joined to `poliklinik` by `tgl_registrasi`, then opens a JFreeChart window. It is a live query, not a saved report: no `temporary` row and no file export.
- **Tabel:** reads `reg_periksa`, `poliklinik`.

## Where it usually goes wrong

- **Each report uses a different date column.** Steps 1, 4 (the "Tanggal Masuk" tab) and 5 filter `reg_periksa.tgl_registrasi`; step 2 and RL 4A's "Tanggal Keluar" tab filter the discharge date (`kamar_inap.tgl_keluar`). Patients still in the ward are absent from the discharge view, and a stay crossing month-end lands in the discharge month. Two "January" reports can describe different populations.
- **Outpatient reports drop patients who were admitted.** `DlgRBTindakanPoli` adds `reg_periksa.no_rawat not in (select no_rawat from kamar_inap)`, so a poli visit that became a ranap is counted only on the inpatient side. Ralan + Ranap totals will not equal registrations; do not reconcile them as if they should.
- **Print output is shared scratch data.** Jasper reports do `delete from temporary where temp37=<client IP>` then re-insert, so two clients behind one IP (or a second print before the first viewer refreshes) can overwrite each other. HTML reports overwrite `rekapkunjungan.html` / `rl4a.html` / `rl4b.html` in the working directory — last print wins.
- **RL counters have known attribution quirks.** RL 4A/4B trust the `diagnosa_pasien.status` label, so a ranap diagnosis typed as "Ralan" moves the case to RL 4B, and 4B counts only `status_penyakit='Baru'`; both count a death by RM even when the death falls outside the period. RL 3.2's "pulang" filter is written `stts_pulang<>('Rujuk' or 'Meninggal' or 'Pindah Kamar')`, which MySQL evaluates as one value, so the "pulang" column is close to the "dirawat" count.

The separate top-menu **Dashboard** is not one of these forms and is not in `index.json`: it opens web
pages (`bed3.php`, `bed4.php`, `poli.php`, `jadwaldokter2.php`, `jadwaloperasi.php`) through
`Valid.panggilUrl`, so it needs the hospital web module and is outside the scope of the desktop forms and
`index.json`.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `reg_periksa` | 1–6 | read |
| `rawat_jl_dr`, `rawat_jl_drpr` | 1 | read |
| `rawat_inap_dr`, `rawat_inap_drpr`, `rawat_inap_pr`, `operasi` | 2 | read |
| `detail_pemberian_obat`, `tagihan_obat_langsung` | 1, 2 | read |
| `periksa_lab`, `detail_periksa_lab`, `periksa_radiologi` | 1, 2 | read |
| `tambahan_biaya`, `pengurangan_biaya` | 1, 2 | read |
| `kamar_inap`, `kamar`, `bangsal` | 2, 4, 5 | read |
| `poliklinik` | 1, 3, 5, 6 | read |
| `pasien` | 1–5 | read |
| `diagnosa_pasien`, `penyakit` | 4 | read |
| `pasien_mati` | 4, 5 | read |
| `rujuk`, `rujuk_masuk` | 5 | read |
| `dokter`, `penjab` | 1, 4 | read |
| `setting` | 1, 2, 5 | read |
| `temporary` | 1, 2, 5 | write |

```json meta
{
  "id": "bridging-bpjs",
  "title": "Bridging BPJS VClaim: SEP, surat kontrol, klaim, antrean",
  "keywords": ["bpjs", "vclaim", "sep", "surat kontrol", "skdp", "rujukan", "klaim", "inacbg", "antrean", "mobile jkn"],
  "menus": ["L/Cek No.Kartu VClaim", "L/Data Bridging SEP VClaim", "L/Cek Nomor SEP", "L/Surat Kontrol VClaim", "L/Monitoring Verifikasi Klaim BPJS", "L/Antrean Per Tanggal Mobile JKN", "K/RVP Piutang BPJS"],
  "forms": ["BPJSCekKartu", "BPJSDataSEP", "BPJSCekDetailSEP2", "BPJSSuratKontrol", "BPJSMonitoringKlaim", "BPJSAntreanPerTanggal", "KeuanganRVPBPJS"]
}
```

# Bridging BPJS VClaim: SEP, surat kontrol, klaim, antrean

Group **L** holds 168 buttons, most of them a thin Swing screen over one VClaim endpoint. Each call
sends the hospital credentials (`CONSIDAPIBPJS`, `USERKEYAPIBPJS`), a UTC timestamp and an HMAC
signature, and is decrypted with the same key. BPJS patients are the visits with `kd_pj = 'BPJ'`;
general patients are `A09`. The SEP is bound to a visit through `bridging_sep.no_rawat`, and that link
is what every claim and receivable report joins on.

## Steps

### 1. Check card and eligibility
- **Menu:** `L/Cek No.Kartu VClaim` (form `BPJSCekKartu`) or `L/Cek NIK VClaim` (form `BPJSCekNIK2`)
- **Who:** `bpjs_cek_kartu` / `bpjs_cek_nik`, usually the registration desk before `A/Registrasi`.
- **Does:** asks VClaim for the participant (name, class, active status). If the patient arrived from a booking, the same screen marks `booking_registrasi.status = 'Terdaftar'`; for a new patient it allocates the RM number from `set_no_rkm_medis`. The same screen issues the SEP once the participant is found.
- **Tabel:** writes `booking_registrasi` (status), `set_no_rkm_medis` (new RM); reads `pasien`, `booking_registrasi`.

### 2. Issue the SEP
- **Menu:** `L/Data Bridging SEP VClaim` (form `BPJSDataSEP`); the same dialog also opens pre-filled from `A/Registrasi`, `A/Rawat Jalan`, `A/Rawat Inap` and `A/IGD/UGD`.
- **Who:** `bpjs_sep`.
- **Does:** POST `/SEP/2.0/insert` with noKartu, tglSep, `jnsPelayanan` **1** (ralan) / **2** (ranap), kelas rawat hak plus naik kelas + pembiayaan, rujukan (asal `1. Faskes 1` / `2. Faskes 2(RS)`, date, number, PPK), diagnosa awal, poli and DPJP. On `metaData.code = 200` it stores the returned SEP number and fills all 52 columns of `bridging_sep`.
- **Tabel:** writes `bridging_sep`; reads `reg_periksa`, `pasien`, `rujuk_masuk`, `maping_poli_bpjs`, `maping_dokter_dpjpvclaim`.

### 3. Correct, discharge, or delete a SEP
- **Menu:** `L/Data Bridging SEP VClaim` (`BPJSDataSEP`); `L/Cek Nomor SEP` (`BPJSCekDetailSEP2`) for a read-only lookup; `L/Data SEP Internal VClaim` (`BPJSCekDataSEPInternal`) for internal SEP rows.
- **Who:** `bpjs_sep`; `bpjs_cek_sep` for the lookup; `bpjs_sep_internal` for internal data.
- **Does:** `PUT /SEP/2.0/update` for class/DPJP/poli corrections; `PUT /SEP/2.0/updtglplg` for the discharge (status pulang + `tglPulang`), which on success writes `bridging_sep.tglpulang`; `DELETE /SEP/2.0/delete` removes the SEP at BPJS and then locally; internal SEP deletion uses `/SEP/Internal/delete`.
- **Tabel:** writes `bridging_sep` (`tglpulang`), `bridging_sep_internal`; reads `bridging_sep`.

### 4. Create the surat kontrol / SKDP for the next visit
- **Menu:** `L/Surat Kontrol VClaim` (form `BPJSSuratKontrol`); `L/Cek SKDP VClaim` (`BPJSCekSKDP`) to verify a number.
- **Who:** `bpjs_surat_kontrol`; `bpjs_cek_skdp` for the lookup.
- **Does:** creates the control letter on an existing SEP with `tgl_surat`, `tgl_rencana` (the next visit), BPJS doctor code/name and BPJS poli code/name. If the property `JADIKANBOOKINGSURATKONTROLAPIBPJS = yes`, it also inserts a `booking_registrasi` row for `tgl_rencana`; otherwise the booking is left to the registration desk. Deleting a letter calls the API and then deletes the local row.
- **Tabel:** writes `bridging_surat_kontrol_bpjs`, `booking_registrasi`; reads `bridging_sep`, `booking_registrasi`, `maping_poli_bpjs`, `maping_dokter_dpjpvclaim`.

### 5. Group and create the claim in INACBG
- **Menu:** `L/Klaim Baru Otomatis INACBG`, `L/Klaim Baru Manual INACBG`, `L/Klaim Baru Manual INACBG 2`; `L/Coder NIK INACBG` (form `INACBGCoderNIK`) registers the coder.
- **Who:** `inacbg_klaim_baru_otomatis` / `inacbg_klaim_baru_manual` / `inacbg_klaim_baru_manual2`; the login user also needs a row in `inacbg_coder_nik` or the screen refuses to open.
- **Does:** these three have no Swing form — the menu opens the HybridWeb page (`inacbg/login.php`, page `KlaimBaruOtomatis`/manual) as an embedded browser. Grouping lands in `inacbg_grouping_stage1` per `no_sep`; the claim header in `inacbg_klaim_baru2` per `no_rawat` with `patient_id` as the claim id, shown as "Belum"/"Belum Terkirim" in the cashier and ranap lists until it exists.
- **Tabel:** `L/Coder NIK INACBG` writes `inacbg_coder_nik` and reads `pegawai`; the claim itself has no Swing tables — `inacbg_klaim_baru2` and `inacbg_grouping_stage1` are written on the HybridWeb side (columns perlu dicek di HybridWeb).

### 6. Monitor claim verification
- **Menu:** `L/Monitoring Verifikasi Klaim BPJS` (form `BPJSMonitoringKlaim`)
- **Who:** `bpjs_monitoring_klaim`; pharmacy claims use `L/Monitoring Klaim Apotek BPJS` (`bpjs_monitoring_klaim_apotek`).
- **Does:** GET `/Monitoring/Klaim/Tanggal/<tgl>/JnsPelayanan/<1|2>/Status/<status>` and lists what BPJS has verified. Nothing is cached locally — the grid goes to `temporary`, so re-run it whenever you need the current status.
- **Tabel:** reads `bridging_sep`, `bridging_sep_internal`; writes `temporary`.

### 7. Reconcile and settle the claim payment
- **Menu:** `K/RVP Piutang BPJS` (form `KeuanganRVPBPJS`), `K/Klaim Rawat Jalan` (`KeuanganKlaimRalan`), then `K/Bayar Piutang` (`DlgBayarPiutang`).
- **Who:** `rvu_bpjs`, `klaim_rawat_jalan`, `bayar_piutang`.
- **Does:** RVP compares the grouped tariff against what BPJS actually pays for each SEP; `K/Klaim Rawat Jalan` lists outpatient claims; `K/Bayar Piutang` records the settlement and sets `piutang_pasien.status = 'Lunas'`.
- **Tabel:** reads `bridging_sep`, `inacbg_grouping_stage1`, `inacbg_klaim_baru2`, `billing`, `piutang_pasien`; writes `bayar_piutang`, `tampjurnal`.

### 8. Antrean Mobile JKN
- **Menu:** `L/Antrean Per Tanggal Mobile JKN` (form `BPJSAntreanPerTanggal`), `L/Task ID Mobile JKN` (`BPJSTaskIDMobileJKN`), `L/Referensi Pendaftaran Mobile JKN` (`MobileJKNReferensiPendaftaran`).
- **Who:** `bpjs_antrean_pertanggal`, `bpjs_task_id`, `referensi_mobilejkn_bpjs`.
- **Does:** pulls bookings for a date (`GET /antrean/pendaftaran/tanggal/<tgl>`) into `referensi_mobilejkn_bpjs`, reads task ids (`/antrean/getlisttask`), moves a queue (`/antrean/updatewaktu`) and cancels one (`/antrean/batal`). These calls use the Mobile JKN channel credentials (`CONSIDAPIMOBILEJKN`, `USERKEYAPIMOBILEJKN`, `URLAPIMOBILEJKN`), not the VClaim ones. Registering a Mobile JKN booking updates `reg_periksa.jam_reg`.
- **Tabel:** writes `referensi_mobilejkn_bpjs`, `referensi_mobilejkn_bpjs_taskid`, `reg_periksa`; reads `bridging_sep`, `maping_poli_bpjs`, `pasien`.

## Where it usually goes wrong

- **The local mirror is written only on success.** Insert, update, discharge and delete all check `metaData.code = 200` first; a timeout after BPJS already issued the SEP leaves BPJS holding a SEP the database does not know. Look it up in `L/Cek Nomor SEP` before issuing again — two SEPs for one visit split the bill and break the RVP.
- **Discharge date does not travel by itself.** `bridging_sep.tglpulang` is only written by the SEP discharge action (`/SEP/2.0/updtglplg`). Setting `stts_pulang` in `A/Rawat Inap` does not touch the SEP, so an inpatient claim can carry the wrong length of stay until someone runs that action.
- **Surat kontrol needs a local SEP.** `bridging_surat_kontrol_bpjs.no_sep` is a foreign key to `bridging_sep.no_sep`, so a SEP issued elsewhere or deleted locally blocks the letter. With `JADIKANBOOKINGSURATKONTROLAPIBPJS = yes` the booking is created after the letter; if it fails, the letter already exists at BPJS and "Gagal menyimpan booking" is the only trace.
- **Rights and credentials are split.** There is no `klaim_bpjs` right: claim work is spread over `bpjs_monitoring_klaim`, `inacbg_klaim_baru_*`, `rvu_bpjs` and `klaim_rawat_jalan`. And antrean has its own credentials and base URL, so SEP can work perfectly while every antrean call fails.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `bridging_sep` | 2, 3, 6, 7 | 2–3 write (52 columns, keyed `no_sep`), 6–7 read |
| `bridging_sep_internal` | 3, 6 | 3 write, 6 read |
| `bridging_surat_kontrol_bpjs` | 4 | write (8 columns, FK `no_sep`) |
| `booking_registrasi` | 1, 4 | write (`status = 'Terdaftar'` at SEP check-in; new row from surat kontrol when the property is `yes`) |
| `set_no_rkm_medis` | 1 | write when a new RM number is allocated |
| `reg_periksa` | 2, 8 | read; `jam_reg` write on Mobile JKN check-in |
| `pasien` | 1, 2 | read |
| `rujuk_masuk` | 2 | read |
| `maping_poli_bpjs`, `maping_dokter_dpjpvclaim` | 2, 4, 8 | read |
| `inacbg_coder_nik` | 5 | write (coder NIK ↔ login), read `pegawai` |
| `inacbg_klaim_baru2` | 5, 7 | claim header per `no_rawat`, `patient_id` is the claim id (written by HybridWeb, read by the cashier lists) |
| `inacbg_grouping_stage1` | 5, 7 | read; grouping result keyed by `no_sep` (written by HybridWeb) |
| `referensi_mobilejkn_bpjs` | 8 | write |
| `referensi_mobilejkn_bpjs_taskid` | 8 | write |
| `piutang_pasien` | 7 | write (`status`) |
| `bayar_piutang` | 7 | write |
| `billing` | 7 | read |
| `temporary` | 1, 3, 6, 7 | write only; scratch grid, never a source of truth |

# [A] Registrasi, Tagihan Ranap & Ralan, Pelayanan & Billing Pasien

Group 0 of 20 · 33 buttons · source `frmUtama.java` → `isCombo()`, commit `2e695e7`.

| # | Menu | Variabel | Hak akses | Form |
|---|---|---|---|---|
| 1 | Informasi Kamar | `btnAnalisaKamar` | informasi_kamar | [InformasiAnalisaKamin](../forms/informasi.md#informasianalisakamin) |
| 2 | Jadwal Praktek | `BtnJadwal` | jadwal_praktek | [DlgJadwal](../forms/kepegawaian.md#dlgjadwal) |
| 3 | Registrasi | `btnRegistrasi` | registrasi | [DlgReg](../forms/simrskhanza.md#dlgreg) |
| 4 | Booking Periksa | `btnBookingPeriksa` | booking_periksa | [DlgBookingPeriksa](../forms/permintaan.md#dlgbookingperiksa) |
| 5 | Booking Registrasi | `btnBookingRegistrasi` | booking_registrasi | [DlgBookingRegistrasi](../forms/permintaan.md#dlgbookingregistrasi) |
| 6 | Booking MCU Perusahaan | `btnBookingMCUPerusahaan` | booking_mcu_perusahaan | [DlgBookingMCUPerusahaan](../forms/permintaan.md#dlgbookingmcuperusahaan) |
| 7 | IGD/UGD | `btnIGD` | igd | [DlgIGD](../forms/simrskhanza.md#dlgigd) |
| 8 | Tindakan Ralan | `btnRalan` | tindakan_ralan | [DlgRawatJalan](../forms/simrskhanza.md#dlgrawatjalan) |
| 9 | Permintaan Rawat Inap | `btnPermintaanRanap` | permintaan_ranap | [DlgPermintaanRanap](../forms/permintaan.md#dlgpermintaanranap) |
| 10 | Rawat Inap | `btnKamarInap` | kamar_inap / billing_ranap / tindakan_ranap | [DlgKamarInap](../forms/simrskhanza.md#dlgkamarinap) |
| 11 | Jadwal Operasi | `btnJadwalOperasi` | booking_operasi | [DlgBookingOperasi](../forms/permintaan.md#dlgbookingoperasi) |
| 12 | Permintaan Lab PK | `btnPermintaanLab` | permintaan_lab / periksa_lab / pemeriksaan_lab_pa / pemeriksaan_lab_mb | [DlgCariPermintaanLab](../forms/permintaan.md#dlgcaripermintaanlab) |
| 13 | Permintaan Lab PA | `btnPermintaanLabPA` | permintaan_lab / periksa_lab / pemeriksaan_lab_pa / pemeriksaan_lab_mb | [DlgCariPermintaanLabPA](../forms/permintaan.md#dlgcaripermintaanlabpa) |
| 14 | Permintaan Lab MB | `btnPermintaanLabMB` | permintaan_lab / periksa_lab / pemeriksaan_lab_pa / pemeriksaan_lab_mb | [DlgCariPermintaanLabMB](../forms/permintaan.md#dlgcaripermintaanlabmb) |
| 15 | Permintaan Radiologi | `btnPermintaanRadiologi` | permintaan_radiologi / periksa_radiologi | [DlgCariPermintaanRadiologi](../forms/permintaan.md#dlgcaripermintaanradiologi) |
| 16 | DPJP Ranap | `BtnDpjp` | dpjp_ranap | [DlgDpjp](../forms/simrskhanza.md#dlgdpjp) |
| 17 | Tindakan Ranap | `btnRanap` | tindakan_ranap | [DlgRawatInap](../forms/simrskhanza.md#dlgrawatinap) |
| 18 | Operasi/VK | `btnTagihanOperasi` | operasi | [DlgCariTagihanOperasi](../forms/simrskhanza.md#dlgcaritagihanoperasi) |
| 19 | Rujukan Keluar | `btnRujukPasien` | rujukan_keluar | [DlgRujuk](../forms/simrskhanza.md#dlgrujuk) |
| 20 | Rujukan Masuk | `btnRujukMasuk` | rujukan_masuk | [DlgRujukMasuk](../forms/simrskhanza.md#dlgrujukmasuk) |
| 21 | Beri Obat/BHP | `btnBeriObat` | beri_obat | [DlgPemberianObat](../forms/inventory.md#dlgpemberianobat) |
| 22 | Resep Pulang | `btnResepPulang` | resep_pulang | [DlgResepPulang](../forms/inventory.md#dlgreseppulang) |
| 23 | No. Resep | `btnResepObat` | resep_obat | [DlgResepObat](../forms/inventory.md#dlgresepobat) |
| 24 | Diet Pasien | `btnDiet` | diet_pasien | [DlgPemberianDiet](../forms/simrskhanza.md#dlgpemberiandiet) |
| 25 | Skrining Rawat Jalan | `btnSkriningRawatJalan` | sekrining_rawat_jalan | [RMSKriningRawatJalan](../forms/rekammedis.md#rmskriningrawatjalan) |
| 26 | Deteksi Dini Corona | `btnDeteksiDiniCorona` | deteksi_corona | [RMDeteksiDiniCorona](../forms/rekammedis.md#rmdeteksidinicorona) |
| 27 | Periksa Lab PK | `btnLaboratorium` | periksa_lab | [DlgCariPeriksaLab](../forms/simrskhanza.md#dlgcariperiksalab) |
| 28 | Periksa Lab PA | `btnLaboratoriumPA` | pemeriksaan_lab_pa | [DlgCariPeriksaLabPA](../forms/simrskhanza.md#dlgcariperiksalabpa) |
| 29 | Periksa Lab MB | `btnLaboratoriumMB` | pemeriksaan_lab_mb | [DlgCariPeriksaLabMB](../forms/simrskhanza.md#dlgcariperiksalabmb) |
| 30 | Periksa Radiologi | `btnPeriksaRadiologi` | periksa_radiologi | [DlgCariPeriksaRadiologi](../forms/simrskhanza.md#dlgcariperiksaradiologi) |
| 31 | Rawat Jalan | `btnKasir` | kasir_ralan / billing_ralan | [DlgKasirRalan](../forms/simrskhanza.md#dlgkasirralan) |
| 32 | Deposit Pasien | `btnDeposit` | deposit_pasien | [DlgDeposit](../forms/keuangan.md#dlgdeposit) |
| 33 | Perkiraan Biaya Ranap | `btnPerkiraanBiayaRanap` | perkiraan_biaya_ranap | [DlgPerkiraanBiayaRanap](../forms/keuangan.md#dlgperkiraanbiayaranap) |

Tabel per form ada di [forms/](../forms/README.md); hak per menu ada di [roles.md](../roles.md).

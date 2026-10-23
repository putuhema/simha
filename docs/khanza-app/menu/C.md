# [C] Presensi, Manajemen & Penggajian Pegawai Rumah Sakit

Group 2 of 20 · 60 buttons · source `frmUtama.java` → `isCombo()`, commit `2e695e7`.

| # | Menu | Variabel | Hak akses | Form |
|---|---|---|---|---|
| 1 | Petugas | `btnPegawai` | petugas | [DlgPetugas](../forms/kepegawaian.md#dlgpetugas) |
| 2 | Dokter | `btnDokter` | dokter | [DlgDokter](../forms/kepegawaian.md#dlgdokter) |
| 3 | Barcode Presensi | `btnBarcode` | barcode | [DlgBarcode](../forms/kepegawaian.md#dlgbarcode) |
| 4 | Sidik Jari | `btnSidikJari` | sidikjari | [DlgSidikJari](../forms/kepegawaian.md#dlgsidikjari) |
| 5 | Jam Presensi | `btnJamPresensi` | jam_masuk | [DlgJamMasuk](../forms/kepegawaian.md#dlgjammasuk) |
| 6 | Jadwal Pegawai | `btnJadwalPegawai` | jadwal_pegawai | [DlgJadwalPegawai](../forms/kepegawaian.md#dlgjadwalpegawai) |
| 7 | Jadwal Tambahan | `btnJadwalTambahan` | jadwal_pegawai | [DlgJadwalTambahan](../forms/kepegawaian.md#dlgjadwaltambahan) |
| 8 | Presensi Harian | `btnRekapHarian` | presensi_harian | [DlgHarian](../forms/kepegawaian.md#dlgharian) |
| 9 | Presensi Bulanan | `btnRekapBulanan` | presensi_bulanan | [DlgBulanan](../forms/kepegawaian.md#dlgbulanan) |
| 10 | Temporary Presensi | `btnTemporaryPresensi` | temporary_presensi | [DlgTemporaryPresensi](../forms/kepegawaian.md#dlgtemporarypresensi) |
| 11 | Pengajuan Cuti | `btnPengajuanCuti` | pengajuan_cuti | [PengajuanCutiAdmin](../forms/kepegawaian.md#pengajuancutiadmin) |
| 12 | Rekap Kehadiran | `btnRekapPresensi` | – | [DlgKehadiran](../forms/kepegawaian.md#dlgkehadiran) |
| 13 | Rekap Kehadiran 2 | `btnRekapPresensi2` | – | [DlgKehadiran2](../forms/kepegawaian.md#dlgkehadiran2) |
| 14 | Kepegawaian & Gaji | `btnPenggajian` | pegawai_admin / pegawai_user | [DlgPenggajian](../forms/kepegawaian.md#dlgpenggajian) |
| 15 | Master Berkas Pegawai | `btnMasterBerkasPegawai` | master_berkas_pegawai | [DlgMasterBerkasPegawai](../forms/kepegawaian.md#dlgmasterberkaspegawai) |
| 16 | Berkas Kepegawaian | `btnBerkasPegawai` | berkas_kepegawaian | [DlgBerkasKepegawaian](../forms/kepegawaian.md#dlgberkaskepegawaian) |
| 17 | Riwayat Jabatan | `btnRiwayatJabatan` | riwayat_jabatan | [DlgRiwayatJabatan](../forms/kepegawaian.md#dlgriwayatjabatan) |
| 18 | Riwayat Pendidikan | `btnRiwayatPendidikan` | riwayat_pendidikan | [DlgRiwayatPendidikan](../forms/kepegawaian.md#dlgriwayatpendidikan) |
| 19 | Riwayat Naik Gaji | `btnRiwayatNaikGaji` | riwayat_naik_gaji | [DlgRiwayatNaikGaji](../forms/kepegawaian.md#dlgriwayatnaikgaji) |
| 20 | Kegiatan Ilmiah & Pelatihan | `btnKegiatanIlmiah` | kegiatan_ilmiah | [DlgKegiatanIlmiah](../forms/kepegawaian.md#dlgkegiatanilmiah) |
| 21 | Riwayat Penghargaan | `btnRiwayatPenghargaan` | riwayat_penghargaan | [DlgRiwayatPenghargaan](../forms/kepegawaian.md#dlgriwayatpenghargaan) |
| 22 | Riwayat Penelitian | `btnRiwayatPenelitian` | riwayat_penelitian | [DlgRiwayatPenelitian](../forms/kepegawaian.md#dlgriwayatpenelitian) |
| 23 | SMS Gateway | `btnSMS` | sms | [frmSmsView](../forms/smsui.md#frmsmsview) |
| 24 | Jenis Cidera K3 | `btnJenisCideraK3` | jenis_cidera_k3rs | [K3RSJenisCidera](../forms/kepegawaian.md#k3rsjeniscidera) |
| 25 | Penyebab Kecelakaan K3 | `btnPenyebabKecelakaanK3` | penyebab_k3rs | [K3RSPenyebab](../forms/kepegawaian.md#k3rspenyebab) |
| 26 | Jenis Luka K3 | `btnJenisLukaK3` | jenis_luka_k3rs | [K3RSJenisLuka](../forms/kepegawaian.md#k3rsjenisluka) |
| 27 | Lokasi Kejadian K3 | `btnLokasiKejadianK3` | lokasi_kejadian_k3rs | [K3RSLokasiKejadian](../forms/kepegawaian.md#k3rslokasikejadian) |
| 28 | Dampak Cidera K3 | `btnDampakCideraK3` | dampak_cidera_k3rs | [K3RSDampakCidera](../forms/kepegawaian.md#k3rsdampakcidera) |
| 29 | Jenis Pekerjaan K3 | `btnJenisPekerjaanK3` | jenis_pekerjaan_k3rs | [K3RSJenisPekerjaan](../forms/kepegawaian.md#k3rsjenispekerjaan) |
| 30 | Bagian Tubuh K3 | `btnBagianTubuhK3` | bagian_tubuh_k3rs | [K3RSBagianTubuh](../forms/kepegawaian.md#k3rsbagiantubuh) |
| 31 | Peristiwa K3 | `btnPeristiwaK3` | peristiwa_k3rs | [K3RSPeristiwa](../forms/kepegawaian.md#k3rsperistiwa) |
| 32 | Jenis Cidera K3 Per Tahun | `btnJenisCideraK3PerTahun` | jenis_cidera_k3rstahun | [K3RSJenisCideraPerTahun](../forms/kepegawaian.md#k3rsjenisciderapertahun) |
| 33 | Penyebab Kecelakaan K3 Per Tahun | `btnPenyebabKecelakaanK3PerTahun` | penyebab_k3rstahun | [K3RSPenyebabPerTahun](../forms/kepegawaian.md#k3rspenyebabpertahun) |
| 34 | Jenis Luka K3 Per Tahun | `btnJenisLukaK3PerTahun` | jenis_luka_k3rstahun | [K3RSJenisLukaPerTahun](../forms/kepegawaian.md#k3rsjenislukapertahun) |
| 35 | Lokasi Kejadian K3 Per Tahun | `btnLokasiKejadianK3PerTahun` | lokasi_kejadian_k3rstahun | [K3RSLokasiKejadianPerTahun](../forms/kepegawaian.md#k3rslokasikejadianpertahun) |
| 36 | Dampak Cidera K3 Per Tahun | `btnDampakCideraK3PerTahun` | dampak_cidera_k3rstahun | [K3RSDampakCideraPerTahun](../forms/kepegawaian.md#k3rsdampakciderapertahun) |
| 37 | Jenis Pekerjaan K3 Per Tahun | `btnJenisPekerjaanK3PerTahun` | jenis_pekerjaan_k3rstahun | [K3RSJenisPekerjaanPerTahun](../forms/kepegawaian.md#k3rsjenispekerjaanpertahun) |
| 38 | Bagian Tubuh K3 Per Tahun | `btnBagianTubuhK3PerTahun` | bagian_tubuh_k3rstahun | [K3RSBagianTubuhPerTahun](../forms/kepegawaian.md#k3rsbagiantubuhpertahun) |
| 39 | Audit Kepatuhan APD | `btnAuditKepatuhanAPD` | audit_kepatuhan_apd | [DlgAuditKepatuhanAPD](../forms/kepegawaian.md#dlgauditkepatuhanapd) |
| 40 | Audit Cuci Tangan Medis | `btnAuditCuciTanganMedis` | audit_cuci_tangan_medis | [DlgAuditCuciTanganMedis](../forms/kepegawaian.md#dlgauditcucitanganmedis) |
| 41 | Ruang/Unit Audit Kepatuhan | `btnRuangAuditKepatuhan` | ruang_audit_kepatuhan | [DlgRuangAuditKepatuhan](../forms/kepegawaian.md#dlgruangauditkepatuhan) |
| 42 | Audit Pembuangan Limbah | `btnAuditPembuanganLimbah` | audit_pembuangan_limbah | [DlgAuditPembuanganLimbah](../forms/kepegawaian.md#dlgauditpembuanganlimbah) |
| 43 | Audit Pembuangan Benda Tajam & Jarum | `btnAuditPembuanganBendaTajam` | audit_pembuangan_benda_tajam | [DlgAuditPembuanganBendaTajam](../forms/kepegawaian.md#dlgauditpembuanganbendatajam) |
| 44 | Audit Penanganan Darah | `btnAuditPenangananDarah` | audit_penanganan_darah | [DlgAuditPenangananDarah](../forms/kepegawaian.md#dlgauditpenanganandarah) |
| 45 | Audit Pengelolaan Linen Kotor | `btnAuditPengelolaanLinenKotor` | audit_pengelolaan_linen_kotor | [DlgAuditPengelolaanLinenKotor](../forms/kepegawaian.md#dlgauditpengelolaanlinenkotor) |
| 46 | Audit Penempatan Pasien | `btnAuditPenempatanPasien` | audit_penempatan_pasien | [DlgAuditPenempatanPasien](../forms/kepegawaian.md#dlgauditpenempatanpasien) |
| 47 | Audit Kamar Jenazah | `btnAuditKamarJenazah` | audit_kamar_jenazah | [DlgAuditKamarJenazah](../forms/kepegawaian.md#dlgauditkamarjenazah) |
| 48 | Audit Bundle IADP | `btnAuditBundleIADP` | audit_bundle_iadp | [DlgAuditBundleIADP](../forms/kepegawaian.md#dlgauditbundleiadp) |
| 49 | Audit Bundle IDO | `btnAuditBundleIDO` | audit_bundle_ido | [DlgAuditBundleIDO](../forms/kepegawaian.md#dlgauditbundleido) |
| 50 | Audit Fasilitas Kebersihan Tangan | `btnAuditFasilitasKebersihanTangan` | audit_fasilitas_kebersihan_tangan | [DlgAuditFasilitasKebersihanTangan](../forms/kepegawaian.md#dlgauditfasilitaskebersihantangan) |
| 51 | Audit Fasilitas APD | `btnAuditFasilitasAPD` | audit_fasilitas_apd | [DlgAuditFasilitasAPD](../forms/kepegawaian.md#dlgauditfasilitasapd) |
| 52 | Audit Pembuangan Limbah Cair Infeksius | `btnAuditPembuanganLimbahCairInfeksius` | audit_pembuangan_limbah_cair_infeksius | [DlgAuditPembuanganLimbahCairInfeksius](../forms/kepegawaian.md#dlgauditpembuanganlimbahcairinfeksius) |
| 53 | Audit Sterilisasi Alat | `btnAuditSterilisasiAlat` | audit_sterilisasi_alat | [DlgAuditSterilisasiAlat](../forms/kepegawaian.md#dlgauditsterilisasialat) |
| 54 | Audit Bundle ISK | `btnAuditBundleISK` | audit_bundle_isk | [DlgAuditBundleISK](../forms/kepegawaian.md#dlgauditbundleisk) |
| 55 | Audit Bundle PLABSI | `btnAuditBundlePLABSI` | audit_bundle_plabsi | [DlgAuditBundlePLABSI](../forms/kepegawaian.md#dlgauditbundleplabsi) |
| 56 | Audit Bundle VAP | `btnAuditBundleVAP` | audit_bundle_vap | [DlgAuditBundleVAP](../forms/kepegawaian.md#dlgauditbundlevap) |
| 57 | Kategori Penilaian SKP | `btnSKPKategoriPenilaian` | skp_kategori_penilaian | [SKPKategoriPenilaian](../forms/kepegawaian.md#skpkategoripenilaian) |
| 58 | Kriteria Penilaian SKP | `btnSKPKriteriaPenilaian` | skp_kriteria_penilaian | [SKPKriteriaPenilaian](../forms/kepegawaian.md#skpkriteriapenilaian) |
| 59 | Penilaian SKP Petugas/Dokter | `btnSKPPenilaianPegawai` | skp_penilaian | [SKPPenilaianPegawai](../forms/kepegawaian.md#skppenilaianpegawai) |
| 60 | Rekapitulasi Penilaian SKP | `btnSKPRekapitulasiPenilaian` | skp_rekapitulasi_penilaian | [SKPRekapitulasiPenilaianPegawai](../forms/kepegawaian.md#skprekapitulasipenilaianpegawai) |

Tabel per form ada di [forms/](../forms/README.md); hak per menu ada di [roles.md](../roles.md).

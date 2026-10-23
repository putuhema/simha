# [I] Olah Data Tagihan Rawat Inap & Rawat Jalan

Group 8 of 20 · 57 buttons · source `frmUtama.java` → `isCombo()`, commit `2e695e7`.

| # | Menu | Variabel | Hak akses | Form |
|---|---|---|---|---|
| 1 | Harian Dokter Poli | `btnTagihanPoli` | harian_tindakan_poli | [DlgRBTindakanPoli](../forms/keuangan.md#dlgrbtindakanpoli) |
| 2 | Harian Kamar | `btnHarianKamar` | harian_kamar | [DlgRBTindakanKamar](../forms/keuangan.md#dlgrbtindakankamar) |
| 3 | Harian Dokter Ralan | `btnTagihanDokter` | harian_tindakan_dokter | [DlgRBTindakanDokter](../forms/keuangan.md#dlgrbtindakandokter) |
| 4 | Obat Per Poli | `btnTagihanObatPoli` | obat_per_poli | [DlgRBObatPoli](../forms/keuangan.md#dlgrbobatpoli) |
| 5 | Obat Per Kamar | `btnTagihanObatBangsal` | obat_per_kamar | [DlgRBObatBangsal](../forms/keuangan.md#dlgrbobatbangsal) |
| 6 | Obat Per Dokter Ralan | `btnObatPasienRalan` | obat_per_dokter_ralan | [DlgRBObatDokterRalan](../forms/keuangan.md#dlgrbobatdokterralan) |
| 7 | Obat Per Dokter Ranap | `btnObatPasienRanap` | obat_per_dokter_ranap | [DlgRBObatDokterRanap](../forms/keuangan.md#dlgrbobatdokterranap) |
| 8 | Obat Per Dokter Peresep | `btnObatPasienPeresep` | obat_per_dokter_peresep | [DlgRBObatDokterPeresep](../forms/keuangan.md#dlgrbobatdokterperesep) |
| 9 | Obat Per Cara Bayar | `btnObatPerCaraBayar` | obat_per_cara_bayar | [DlgRBObatPercaraBayar](../forms/keuangan.md#dlgrbobatpercarabayar) |
| 10 | Detail Tindakan | `btnDetailTindakan` | detail_tindakan | [DlgDetailTindakan](../forms/keuangan.md#dlgdetailtindakan) |
| 11 | Detail JM Dokter | `btnJMDetailDokter` | jm_ranap_dokter | [DlgDetailJMDokter](../forms/keuangan.md#dlgdetailjmdokter) |
| 12 | Detail JM Dokter 2 | `btnJMDetailDokter2` | detailjmdokter2 | [DlgDetailJMDokter2](../forms/keuangan.md#dlgdetailjmdokter2) |
| 13 | Harian Dokter | `btnRHDOkter` | harian_dokter | [DlgRHJmDokter](../forms/keuangan.md#dlgrhjmdokter) |
| 14 | Bulanan Dokter | `btnRBDokter` | bulanan_dokter | [DlgRBJmDokter](../forms/keuangan.md#dlgrbjmdokter) |
| 15 | Rekap JM Dokter | `btnRekapJasaDokter` | rekap_jm_dokter | [KeuanganRekapJmDokter](../forms/keuangan.md#keuanganrekapjmdokter) |
| 16 | Rekap Biaya Registrasi | `btnRekapBiayaRegistrasi` | rekap_biaya_registrasi | [DlgRekapBiayaRegistrasi](../forms/keuangan.md#dlgrekapbiayaregistrasi) |
| 17 | Harian Paramedis | `btnRHParamedis` | harian_paramedis | [DlgRHJmParamedis](../forms/keuangan.md#dlgrhjmparamedis) |
| 18 | Bulanan Paramedis | `btnRBParamedis` | bulanan_paramedis | [DlgRBJmParamedis](../forms/keuangan.md#dlgrbjmparamedis) |
| 19 | Harian Jasa Sarana | `btnRHJasaSarana` | harian_js | [DlgRHJS](../forms/keuangan.md#dlgrhjs) |
| 20 | Bulanan Jasa Sarana | `btnRBJasaSarana` | bulanan_js | [DlgRBJS](../forms/keuangan.md#dlgrbjs) |
| 21 | Harian KSO | `btnRHKSO` | harian_kso | [DlgRHKSO](../forms/keuangan.md#dlgrhkso) |
| 22 | Bulanan KSO | `btnRBKSO` | bulanan_kso | [DlgRBKSO](../forms/keuangan.md#dlgrbkso) |
| 23 | Harian Menejemen | `btnRHMenejemen` | harian_menejemen | [DlgRHMenejemen](../forms/keuangan.md#dlgrhmenejemen) |
| 24 | Bulanan Menejemen | `btnRBMenejemen` | bulanan_menejemen | [DlgRBMenejemen](../forms/keuangan.md#dlgrbmenejemen) |
| 25 | Harian BHP Medis/Paket Obat | `btnRHPaketBHP` | harian_paket_bhp | [DlgRHPaketBHP](../forms/keuangan.md#dlgrhpaketbhp) |
| 26 | Bulanan BHP Medis/Paket Obat | `btnRBPaketBHP` | bulanan_paket_bhp | [DlgRBPaketBHP](../forms/keuangan.md#dlgrbpaketbhp) |
| 27 | Ringkasan Tindakan | `btnRingkasanTindakanRalan` | ringkasan_tindakan | [KeuanganRingkasanTindakan](../forms/keuangan.md#keuanganringkasantindakan) |
| 28 | Fee Visit Dokter | `btnfee_visit_dokter` | fee_visit_dokter | [DlgFeeVisitDokter](../forms/keuangan.md#dlgfeevisitdokter) |
| 29 | Fee Bacaan EKG | `btnfee_bacaan_ekg` | fee_bacaan_ekg | [DlgFeeBacaanEKG](../forms/keuangan.md#dlgfeebacaanekg) |
| 30 | Fee Rujukan Rontgen | `btnfee_rujukan_rontgen` | fee_rujukan_rontgen | [DlgFeeRujukanRontgen](../forms/keuangan.md#dlgfeerujukanrontgen) |
| 31 | Fee Rujukan Ranap | `btnfee_rujukan_ranap` | fee_rujukan_ranap | – |
| 32 | Fee Periksa Ralan | `btnfee_ralan` | fee_ralan | [DlgFeePeriksaRalan](../forms/keuangan.md#dlgfeeperiksaralan) |
| 33 | Detail VK & OK | `btnDetailVKOK` | detail_tindakan_okvk | [DlgDetailVKOK](../forms/keuangan.md#dlgdetailvkok) |
| 34 | Jasa Tindakan Pasien | `btnJasaTindakanPasien` | jasa_tindakan_pasien | [KeuanganJasaTindakan](../forms/keuangan.md#keuanganjasatindakan) |
| 35 | Pembayaran Ralan | `btnRalanMasuk` | pembayaran_ralan | [DlgPembayaranRalan](../forms/keuangan.md#dlgpembayaranralan) |
| 36 | Pembayaran Ranap | `btnRanapMasuk` | pembayaran_ranap | [DlgPembayaranRanap](../forms/keuangan.md#dlgpembayaranranap) |
| 37 | Piutang Pasien | `btnLihatPiutang` | piutang_pasien | [DlgLhtPiutang](../forms/keuangan.md#dlglhtpiutang) |
| 38 | Piutang Ralan | `btnPiutangRalan` | piutang_ralan | [DlgPiutangRalan](../forms/keuangan.md#dlgpiutangralan) |
| 39 | Piutang Ranap | `btnPiutangRanap` | piutang_ranap | [DlgPiutangRanap](../forms/keuangan.md#dlgpiutangranap) |
| 40 | Rekap Pembayaran Ralan | `btnTagihanRalanPerhari` | rekap_pembayaran_ralan | [DlgPembayaranRalanPerHari](../forms/keuangan.md#dlgpembayaranralanperhari) |
| 41 | Rekap Pembayaran Ranap | `btnTagihanRanapPerhari` | rekap_pembayaran_ranap | [DlgPembayaranRanapPerhari](../forms/keuangan.md#dlgpembayaranranapperhari) |
| 42 | Pembayaran Per Unit | `btnPembayaranPerUnit` | pembayaran_per_unit | [DlgPembayaranPerPoli](../forms/keuangan.md#dlgpembayaranperpoli) |
| 43 | Rekap Pembayaran Per Unit | `btnRekapPembayaranPerUnit` | rekap_pembayaran_per_unit | [DlgRekapPembayaranPerPoli](../forms/keuangan.md#dlgrekappembayaranperpoli) |
| 44 | Tagihan Masuk | `btnTagihanMasuk` | tagihan_masuk | [DlgLhtBiaya](../forms/keuangan.md#dlglhtbiaya) |
| 45 | Tambahan Biaya Pasien | `btnTambahanBiaya` | tambahan_biaya | [DlgDetailTambahan](../forms/keuangan.md#dlgdetailtambahan) |
| 46 | Potongan Biaya Pasien | `btnPotonganBiaya` | potongan_biaya | [DlgDetailPotongan](../forms/keuangan.md#dlgdetailpotongan) |
| 47 | Rekap Poli Anak | `btnRekapPoliAnak` | rekap_poli_anak | [KeuanganRekapPoliAnak](../forms/keuangan.md#keuanganrekappolianak) |
| 48 | Deposit Pasien | `btnDeposit` | deposit_pasien | [DlgDeposit](../forms/keuangan.md#dlgdeposit) |
| 49 | Rekap Uang Pershift | `btnRekapPershift` | rekap_per_shift | [DlgRekapPerShift](../forms/keuangan.md#dlgrekappershift) |
| 50 | Payment Point | `btnPaymentPoint` | payment_point | [DlgPaymentPoint](../forms/keuangan.md#dlgpaymentpoint) |
| 51 | Payment Point 2 | `btnPaymentPoint2` | payment_point2 | [DlgPaymentPoint2](../forms/keuangan.md#dlgpaymentpoint2) |
| 52 | Pembayaran Per Akun Bayar | `btnPembayaranAkunBayar` | pembayaran_akun_bayar | [DlgPembayaranPerAKunBayar](../forms/keuangan.md#dlgpembayaranperakunbayar) |
| 53 | Pembayaran Per Akun Bayar 2 | `btnPembayaranAkunBayar2` | pembayaran_akun_bayar2 | [DlgPembayaranPerAKunBayar2](../forms/keuangan.md#dlgpembayaranperakunbayar2) |
| 54 | Pembayaran Per Akun Bayar 3 | `btnPembayaranAkunBayar3` | pembayaran_akun_bayar3 | [DlgPembayaranPerAKunBayar3](../forms/keuangan.md#dlgpembayaranperakunbayar3) |
| 55 | Pembayaran Per Akun Bayar 4 | `btnPembayaranAkunBayar4` | pembayaran_akun_bayar4 | [DlgPembayaranPerAKunBayar4](../forms/keuangan.md#dlgpembayaranperakunbayar4) |
| 56 | Pembayaran Per Akun Bayar 5 | `btnPembayaranAkunBayar5` | pembayaran_akun_bayar5 | [DlgPembayaranPerAKunBayar5](../forms/keuangan.md#dlgpembayaranperakunbayar5) |
| 57 | Piutang Per Akun Piutang | `btnPiutangPerAkunPiutang` | piutang_akun_piutang | [DlgPiutangPerAKunPiutang](../forms/keuangan.md#dlgpiutangperakunpiutang) |

Tabel per form ada di [forms/](../forms/README.md); hak per menu ada di [roles.md](../roles.md).

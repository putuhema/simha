# [E] Transaksi Inventory Barang Non Medis, Penunjang ( Lab & RO )

Group 4 of 20 · 33 buttons · source `frmUtama.java` → `isCombo()`, commit `2e695e7`.

| # | Menu | Variabel | Hak akses | Form |
|---|---|---|---|---|
| 1 | Asal Hibah | `btnAsalHibah` | asal_hibah | [InventarisAsalHibah](../forms/inventaris.md#inventarisasalhibah) |
| 2 | Satuan Barang | `btnSatuan` | satuan_barang | [DlgSatuan](../forms/inventory.md#dlgsatuan) |
| 3 | Jenis Barang Non Medis | `btnJenisIpsrs` | ipsrs_jenis_barang | [IPSRSJenis](../forms/ipsrs.md#ipsrsjenis) |
| 4 | Barang Non Medis | `btnBarangIpsrs` | ipsrs_barang | [IPSRSBarang](../forms/ipsrs.md#ipsrsbarang) |
| 5 | Suplier Non Medis | `btnSuplierIPSRS` | suplier_penunjang | [IPSRSSuplier](../forms/ipsrs.md#ipsrssuplier) |
| 6 | Permintaan Barang Non Medis | `btnPermintaanNonMedis` | permintaan_non_medis | [IPSRSPermintaan](../forms/ipsrs.md#ipsrspermintaan) |
| 7 | Ringkasan Permintaan Barang Non Medis | `btnRekapPermintaanNonMedis` | rekap_permintaan_non_medis | [DlgRekapPermintaanNonMedis](../forms/ipsrs.md#dlgrekappermintaannonmedis) |
| 8 | Pengajuan Barang Non Medis | `btnPengajuanBarangNonMedis` | pengajuan_barang_nonmedis | [IPSRSPengajuanBarangNonMedis](../forms/ipsrs.md#ipsrspengajuanbarangnonmedis) |
| 9 | Ringkasan Pengajuan Non Medis | `btnRingkasanPengajuanNonMedis` | ringkasan_pengajuan_nonmedis | [IPSRSRingkasanPengajuanBarangNonMedis](../forms/ipsrs.md#ipsrsringkasanpengajuanbarangnonmedis) |
| 10 | Surat Pemesanan Barang Non Medis | `btnSuratPemesananNonMedis` | surat_pemesanan_non_medis | [IPSRSSuratPemesanan](../forms/ipsrs.md#ipsrssuratpemesanan) |
| 11 | Ringkasan Pemesanan Non Medis | `btnRingkasanPemesananNonMedis` | ringkasan_pemesanan_nonmedis | [IPSRSRingkasanPemesananBarangNonMedis](../forms/ipsrs.md#ipsrsringkasanpemesananbarangnonmedis) |
| 12 | Pengadaan Barang Non Medis | `btnPembelianIpsrs` | ipsrs_pengadaan_barang | [IPSRSPembelian](../forms/ipsrs.md#ipsrspembelian) |
| 13 | Ringkasan Pengadaan Non Medis | `btnRingkasanPengadaanNonMedis` | ringkasan_pengadaan_nonmedis | [IPSRSRingkasanPengadaanBarangNonMedis](../forms/ipsrs.md#ipsrsringkasanpengadaanbarangnonmedis) |
| 14 | Penerimaan Barang Non Medis | `btnPenerimaanNonMedis` | penerimaan_non_medis | [IPSRSPemesanan](../forms/ipsrs.md#ipsrspemesanan) |
| 15 | Ringkasan Penerimaan Non Medis | `btnRingkasanPenerimaanNonMedis` | ringkasan_penerimaan_nonmedis | [IPSRSRingkasanPenerimaanBarangNonMedis](../forms/ipsrs.md#ipsrsringkasanpenerimaanbarangnonmedis) |
| 16 | Hibah Non Medis | `btnHibahNonMedis` | hibah_non_medis | [IPSRSHibah](../forms/ipsrs.md#ipsrshibah) |
| 17 | Stok Keluar Non Medis | `btnPengeluaranIpsrs` | ipsrs_stok_keluar | [IPSRSPengeluaran](../forms/ipsrs.md#ipsrspengeluaran) |
| 18 | Ringkasan Stok Keluar Non Medis | `btnRingkasanStokKeluarNonMedis` | ringkasan_stokkeluar_nonmedis | [IPSRSRingkasanPengeluaranBarangNonMedis](../forms/ipsrs.md#ipsrsringkasanpengeluaranbarangnonmedis) |
| 19 | Retur Ke Suplier Non Medis | `btnReturBarangNonMedis` | ipsrs_returbeli | [IPSRSReturBeli](../forms/ipsrs.md#ipsrsreturbeli) |
| 20 | Ringkasan Retur Suplier Non Medis | `btnRingkasanReturSuplierNonMedis` | ringkasan_returbeli_nonmedis | [IPSRSRingkasanReturBeliBarangNonMedis](../forms/ipsrs.md#ipsrsringkasanreturbelibarangnonmedis) |
| 21 | Riwayat Barang Non Medis | `btnRiwayatBarangNonMedis` | ipsrs_riwayat_barang | [IPSRSRiwayatBarang](../forms/ipsrs.md#ipsrsriwayatbarang) |
| 22 | Biaya Pengadaan Non Medis | `btnRBiayaIpsrs` | ipsrs_pengeluaran_harian | [DlgRBiayaHarianIPSRS](../forms/ipsrs.md#dlgrbiayaharianipsrs) |
| 23 | Rekap Pengadaan Non Medis | `btnRHMasukIpsrs` | ipsrs_rekap_pengadaan | [DlgRHPembelianIPSRS](../forms/ipsrs.md#dlgrhpembelianipsrs) |
| 24 | Rekap Stok Keluar Non Medis | `btnRHKeluarIpsrs` | ipsrs_rekap_stok_keluar | [DlgRHPengeluaranIPSRS](../forms/ipsrs.md#dlgrhpengeluaranipsrs) |
| 25 | Pengambilan UTD | `btnPengambilanPenunjangUTD` | pengambilan_penunjang_utd | [IPSRSPengambilanPenunjangUTD](../forms/ipsrs.md#ipsrspengambilanpenunjangutd) |
| 26 | Pengadaan Non Medis Per Tanggal | `btnPengadaanIPSRSPerTanggal` | ipsrs_pengadaan_pertanggal | [DlgPengadaanIPSRSPerTanggal](../forms/ipsrs.md#dlgpengadaanipsrspertanggal) |
| 27 | Stok Keluar Non Medis Per Tanggal | `btnStokKeluarIPSRSPerTanggal` | ipsrs_stokkeluar_pertanggal | [DlgStokKeluarIPSRSPerTanggal](../forms/ipsrs.md#dlgstokkeluaripsrspertanggal) |
| 28 | Rekap Penerimaan Non Medis | `btnRekapPenerimaanNonMedis` | rekap_pemesanan_non_medis | [DlgRekapPenerimaanNonMedis](../forms/ipsrs.md#dlgrekappenerimaannonmedis) |
| 29 | Stok Opname Non Medis | `btnOpnameIPSRS` | stok_opname_logistik | [IPSRSInputStok](../forms/ipsrs.md#ipsrsinputstok) |
| 30 | Sirkulasi Non Medis | `btnSirkulasiNonMedis` | sirkulasi_non_medis | [DlgSirkulasiNonMedis](../forms/ipsrs.md#dlgsirkulasinonmedis) |
| 31 | Sirkulasi Non Medis 2 | `btnSirkulasiNonMedis2` | sirkulasi_non_medis2 | [DlgSirkulasiNonMedis2](../forms/ipsrs.md#dlgsirkulasinonmedis2) |
| 32 | Verifikasi Penerimaan Non Medis | `btnVerifikasiPenerimaanLogistik` | verifikasi_penerimaan_logistik | [IPSRSVerifikasiPenerimaan](../forms/ipsrs.md#ipsrsverifikasipenerimaan) |
| 33 | Nilai Penerimaan Vendor Non Medis Per Bulan | `btnNilaiPenerimaanVendorNonMedisPerBulan` | nilai_penerimaan_vendor_nonmedis_perbulan | [IPSRSNilaiPenerimaanVendorNonMedisPerBulan](../forms/ipsrs.md#ipsrsnilaipenerimaanvendornonmedisperbulan) |

Tabel per form ada di [forms/](../forms/README.md); hak per menu ada di [roles.md](../roles.md).

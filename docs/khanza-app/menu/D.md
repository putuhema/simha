# [D] Transaksi Inventory Obat, BHP Medis, Alat Kesehatan Pasien

Group 3 of 20 · 75 buttons · source `frmUtama.java` → `isCombo()`, commit `2e695e7`.

| # | Menu | Variabel | Hak akses | Form |
|---|---|---|---|---|
| 1 | Asal Hibah | `btnAsalHibah` | asal_hibah | [InventarisAsalHibah](../forms/inventaris.md#inventarisasalhibah) |
| 2 | Industri Farmasi | `btnIndustriFarmasi` | industrifarmasi | [DlgIndustriFarmasi](../forms/inventory.md#dlgindustrifarmasi) |
| 3 | Suplier Obat/Alkes/BHP | `btnSuplier` | suplier | [InventorySuplier](../forms/inventory.md#inventorysuplier) |
| 4 | Satuan Barang | `btnSatuan` | satuan_barang | [DlgSatuan](../forms/inventory.md#dlgsatuan) |
| 5 | Metode Racik | `btnMetodeRacik` | metode_racik | [DlgMetodeRacik](../forms/inventory.md#dlgmetoderacik) |
| 6 | Konversi Satuan | `btnKonversi` | konversi_satuan | [DlgKonversi](../forms/inventory.md#dlgkonversi) |
| 7 | Jenis Obat, Alkes & BHP | `btnJnsBarang` | jenis_barang | [DlgJenis](../forms/inventory.md#dlgjenis) |
| 8 | Kategori Obat, Alkes & BHP | `btnKategoriBarang` | kategori_barang | [DlgKategori](../forms/inventory.md#dlgkategori) |
| 9 | Golongan Obat, Alkes & BHP | `btnGolonganBarang` | golongan_barang | [DlgGolongan](../forms/inventory.md#dlggolongan) |
| 10 | Obat, Alkes & BHP | `btnObat` | obat | [DlgBarang](../forms/inventory.md#dlgbarang) |
| 11 | Stok Opname Obat & BHP | `btnOpname` | stok_opname_obat | [DlgInputStok](../forms/inventory.md#dlginputstok) |
| 12 | Mutasi Obat & BHP | `btnMutasiBarang` | mutasi_barang | [DlgMutasiBarang](../forms/inventory.md#dlgmutasibarang) |
| 13 | Permintaan Stok Obat Pasien | `btnPermintaanStokObatPasien` | permintaan_stok_obat_pasien | [DlgDaftarPermintaanStokPasien](../forms/inventory.md#dlgdaftarpermintaanstokpasien) |
| 14 | Permintaan Resep Pulang | `btnPermintaanResepPulang` | permintaan_resep_pulang | [DlgDaftarPermintaanResepPulang](../forms/inventory.md#dlgdaftarpermintaanreseppulang) |
| 15 | Stok Obat Pasien | `btnStokObatPasien` | stok_obat_pasien | [DlgStokPasien](../forms/inventory.md#dlgstokpasien) |
| 16 | Permintaan Obat & BHP | `btnPermintaanMedis` | permintaan_medis / mutasi_barang / pengeluaran_stok_apotek | [DlgPermintaan](../forms/inventory.md#dlgpermintaan) |
| 17 | Ringkasan Permintaan Obat & BHP | `btnRingkasanPermintaanMedis` | rekap_permintaan_medis | [DlgRekapPermintaan](../forms/inventory.md#dlgrekappermintaan) |
| 18 | Pengajuan Obat & BHP | `btnPengajuanBarangMedis` | pengajuan_barang_medis | [InventoryPengajuanBarangMedis](../forms/inventory.md#inventorypengajuanbarangmedis) |
| 19 | Ringkasan Pengajuan Obat & BHP | `btnRingkasanPengajuanMedis` | ringkasan_pengajuan_obat | [InventoryRingkasanPengajuanBarangMedis](../forms/inventory.md#inventoryringkasanpengajuanbarangmedis) |
| 20 | Surat Pemesanan Obat & BHP | `btnSuratPemesananMedis` | surat_pemesanan_medis / pemesanan_obat | [InventorySuratPemesanan](../forms/inventory.md#inventorysuratpemesanan) |
| 21 | Ringkasan Pemesanan Obat & BHP | `btnRingkasanPemesananMedis` | ringkasan_pemesanan_obat | [InventoryRingkasanPemesananBarangMedis](../forms/inventory.md#inventoryringkasanpemesananbarangmedis) |
| 22 | Pengadaan Obat & BHP | `btnPembelian` | pengadaan_obat | [DlgPembelian](../forms/inventory.md#dlgpembelian) |
| 23 | Ringkasan Pengadaan Obat & BHP | `btnRingkasanPembelianMedis` | ringkasan_pengadaan_obat | [InventoryRingkasanPembelianBarangMedis](../forms/inventory.md#inventoryringkasanpembelianbarangmedis) |
| 24 | Penerimaan Obat & BHP | `btnPemesanan` | pemesanan_obat / bayar_pemesanan_obat | [DlgPemesanan](../forms/inventory.md#dlgpemesanan) |
| 25 | Ringkasan Penerimaan Obat & BHP | `btnRingkasanPenerimaanMedis` | ringkasan_penerimaan_obat | [InventoryRingkasanPenerimaanBarangMedis](../forms/inventory.md#inventoryringkasanpenerimaanbarangmedis) |
| 26 | Hibah Obat & BHP | `btnHibahObatBHP` | hibah_obat_bhp | [InventoryHibahObatBHP](../forms/inventory.md#inventoryhibahobatbhp) |
| 27 | Ringkasan Hibah Obat & BHP | `btnRingkasanHibahMedis` | ringkasan_hibah_obat | [InventoryRingkasanHibahBarangMedis](../forms/inventory.md#inventoryringkasanhibahbarangmedis) |
| 28 | Penjualan Obat & BHP | `btnPenjualan` | penjualan_obat | [DlgPenjualan](../forms/inventory.md#dlgpenjualan) |
| 29 | Ringkasan Penjualan Obat & BHP | `btnRingkasanPenjualanMedis` | ringkasan_penjualan_obat | [InventoryRingkasanPenjualanBarangMedis](../forms/inventory.md#inventoryringkasanpenjualanbarangmedis) |
| 30 | Ringkasan Beri Obat & BHP | `btnRingkasanBeriObat` | ringkasan_beri_obat | [InventoryRingkasanBeriObat](../forms/inventory.md#inventoryringkasanberiobat) |
| 31 | Daftar Resep Dokter | `btnDaftarPermintaanResep` | resep_dokter | [DlgDaftarPermintaanResep](../forms/inventory.md#dlgdaftarpermintaanresep) |
| 32 | Piutang Obat & BHP | `btnPiutang` | piutang_obat | [DlgPiutang](../forms/inventory.md#dlgpiutang) |
| 33 | Ringkasan Piutang Obat & BHP | `btnRingkasanPiutangObat` | ringkasan_piutang_obat | [InventoryRingkasanPiutangBarangMedis](../forms/inventory.md#inventoryringkasanpiutangbarangmedis) |
| 34 | Stok Keluar Medis | `btnStokKeluarMedis` | pengeluaran_stok_apotek | [DlgPengeluaranApotek](../forms/inventory.md#dlgpengeluaranapotek) |
| 35 | Ringkasan Stok Keluar Obat & BHP | `btnRingkasanStokKeluarObat` | ringkasan_stok_keluar_obat | [InventoryRingkasanStokKeluarBarangMedis](../forms/inventory.md#inventoryringkasanstokkeluarbarangmedis) |
| 36 | Retur Ke Suplier | `btnReturBeli` | retur_ke_suplier | [DlgReturBeli](../forms/inventory.md#dlgreturbeli) |
| 37 | Ringkasan Retur Suplier Obat & BHP | `btnRingkasanReturSuplierObat` | ringkasan_retur_suplier_obat | [InventoryRingkasanReturSuplierBarangMedis](../forms/inventory.md#inventoryringkasanretursuplierbarangmedis) |
| 38 | Retur Dari Pembeli | `btnReturJual` | retur_dari_pembeli | [DlgReturJual](../forms/inventory.md#dlgreturjual) |
| 39 | Ringkasan Retur Pembeli Obat & BHP | `btnRingkasanReturJualObat` | ringkasan_retur_pembeli_obat | [InventoryRingkasanReturJualBarangMedis](../forms/inventory.md#inventoryringkasanreturjualbarangmedis) |
| 40 | Retur Obat Ranap | `btnReturPasien` | retur_obat_ranap | [DlgReturObatPasien](../forms/inventory.md#dlgreturobatpasien) |
| 41 | Retur Piutang Pembeli | `btnReturPiutang` | retur_piutang_pasien | [DlgReturPiutang](../forms/inventory.md#dlgreturpiutang) |
| 42 | Pengambilan BHP UTD | `btnPengambilanUTD` | pengambilan_utd | [DlgPengambilanUTD](../forms/inventory.md#dlgpengambilanutd) |
| 43 | Keuntungan Penjualan | `btnKeuntungan` | keuntungan_penjualan | [DlgProyeksiJual](../forms/inventory.md#dlgproyeksijual) |
| 44 | Keuntungan Beri Obat  | `btnKeuntunganObatRanap` | keuntungan_beri_obat | [DlgProyeksiBeriObat](../forms/inventory.md#dlgproyeksiberiobat) |
| 45 | Keuntungan Beri Obat 2 | `btnKeuntunganObat2` | keuntungan_beri_obat_nonpiutang | [DlgProyeksiBeriObat2](../forms/inventory.md#dlgproyeksiberiobat2) |
| 46 | Sirkulasi Obat, Alkes & BHP | `btnSirkulasi` | sirkulasi_obat | [DlgSirkulasiBarang](../forms/inventory.md#dlgsirkulasibarang) |
| 47 | Sirkulasi Obat, Alkes & BHP 2 | `btnSirkulasi2` | sirkulasi_obat2 | [DlgSirkulasiBarang2](../forms/inventory.md#dlgsirkulasibarang2) |
| 48 | Sirkulasi Obat, Alkes & BHP 3 | `btnSirkulasi3` | sirkulasi_obat3 | [DlgSirkulasiBarang3](../forms/inventory.md#dlgsirkulasibarang3) |
| 49 | Sirkulasi Obat, Alkes & BHP 4 | `btnSirkulasiObat4` | sirkulasi_obat4 | [DlgSirkulasiBarang4](../forms/inventory.md#dlgsirkulasibarang4) |
| 50 | Sirkulasi Obat, Alkes & BHP 5 | `btnSirkulasiObat5` | sirkulasi_obat5 | [DlgSirkulasiBarang5](../forms/inventory.md#dlgsirkulasibarang5) |
| 51 | Sirkulasi Obat, Alkes & BHP 6 | `btnSirkulasiObat6` | sirkulasi_obat6 | [DlgSirkulasiBarang6](../forms/inventory.md#dlgsirkulasibarang6) |
| 52 | Obat/Alkes/BHP Per Tanggal | `btnObatPerTanggal` | pemberian_obat_pertanggal | [DlgObatPerTanggal](../forms/inventory.md#dlgobatpertanggal) |
| 53 | Penjualan Bebas Per Tanggal | `btnPenjualanPerTanggal` | penjualan_obat_pertanggal | [DlgPenjualanPerTanggal](../forms/inventory.md#dlgpenjualanpertanggal) |
| 54 | Riwayat Obat, Alkes & BHP | `btnRiwayatBarangMedis` | riwayat_obat_alkes_bhp | [DlgRiwayatBarangMedis](../forms/inventory.md#dlgriwayatbarangmedis) |
| 55 | Darurat Stok | `btnDaruratStok` | darurat_stok | [DlgDaruratStok](../forms/inventory.md#dlgdaruratstok) |
| 56 | Pengguna Obat/Alkes/BHP Resep | `btnPenggunaObatResep` | pengguna_obat_resep | [DlgPenggunaObat](../forms/inventory.md#dlgpenggunaobat) |
| 57 | Rekap Penerimaan Obat & BHP | `btnRekapPenerimaanObat` | rekap_pemesanan | [DlgRekapPenerimaan](../forms/inventory.md#dlgrekappenerimaan) |
| 58 | Data Batch | `btnDataBatch` | data_batch | [DlgDataBatch](../forms/inventory.md#dlgdatabatch) |
| 59 | Riwayat Batch | `btnRiwayatBatch` | riwayat_data_batch | [DlgRiwayatBatch](../forms/inventory.md#dlgriwayatbatch) |
| 60 | Kegiatan Farmasi | `btnKegiatanFarmasi` | kegiatan_farmasi | [DlgKegiatanFarmasi](../forms/inventory.md#dlgkegiatanfarmasi) |
| 61 | PPN Obat | `btnPPNObat` | ppn_obat | [DlgCariPPNObat](../forms/inventory.md#dlgcarippnobat) |
| 62 | Kadaluarsa Batch | `btnKadaluarsaBatch` | kadaluarsa_batch | [DlgKadaluarsaBatch](../forms/inventory.md#dlgkadaluarsabatch) |
| 63 | Sisa Stok | `btnSisaStok` | sisa_stok | [DlgSisaStok](../forms/inventory.md#dlgsisastok) |
| 64 | Obat Per Resep | `btnObatPerResep` | obat_per_resep | [DlgObatPeresep](../forms/inventory.md#dlgobatperesep) |
| 65 | 10 Obat Terbanyak Poli | `btn10BesarObatPoli` | obat10_terbanyak_poli | [Dlg10ObatTerbanyakPoli](../forms/inventory.md#dlg10obatterbanyakpoli) |
| 66 | Rekap Obat Per Poli | `btnRekapObatPoli` | rekap_obat_poli | [DlgRekapObatPoli](../forms/inventory.md#dlgrekapobatpoli) |
| 67 | Rekap Obat Per Pasien | `btnRekapObatPasien` | rekap_obat_pasien | [DlgRekapObatPasien](../forms/inventory.md#dlgrekapobatpasien) |
| 68 | Verifikasi Penerimaan Obat/Alkes/BHP | `btnVerifikasiPenerimaanFarmasi` | verifikasi_penerimaan_farmasi | [InventoryVerifikasiPenerimaan](../forms/inventory.md#inventoryverifikasipenerimaan) |
| 69 | Penggunaan BHP OK/VK | `btnPenggunaanBHPOK` | penggunaan_bhp_ok | [InventoryPenggunaanBHPOK](../forms/inventory.md#inventorypenggunaanbhpok) |
| 70 | Resep Luar | `btnResepLuar` | resep_luar | [InventoryCariResepLuar](../forms/inventory.md#inventorycariresepluar) |
| 71 | Stok Akhir Farmasi Per Tanggal | `btnStokAkhirFarmasiPerTanggal` | stok_akhir_farmasi_pertanggal | [InventoryStokAkhirFarmasiPerTanggal](../forms/inventory.md#inventorystokakhirfarmasipertanggal) |
| 72 | Telaah Resep & Obat | `btnTelaahResep` | telaah_resep | [InventoryTelaahResep](../forms/inventory.md#inventorytelaahresep) |
| 73 | Ringkasan Biaya Obat Pasien Per Tanggal | `btnRingkasanBiayaObatPasienPerTanggal` | ringkasan_biaya_obat_pasien_pertanggal | [InventoryRingkasanBiayaObatPasienPerTanggal](../forms/inventory.md#inventoryringkasanbiayaobatpasienpertanggal) |
| 74 | Nilai Penerimaan Vendor Farmasi Per Bulan | `btnNilaiPenerimaanVendorFarmasiPerBulan` | nilai_penerimaan_vendor_farmasi_perbulan | [InventoryNilaiPenerimaanVendorFarmasiPerBulan](../forms/inventory.md#inventorynilaipenerimaanvendorfarmasiperbulan) |
| 75 | Obat/Alkes/BHP Tidak Bergerak | `btnObatBHPTidakBergerak` | obat_bhp_tidakbergerak | [InventoryObatBHPTidakBergerak](../forms/inventory.md#inventoryobatbhptidakbergerak) |

Tabel per form ada di [forms/](../forms/README.md); hak per menu ada di [roles.md](../roles.md).

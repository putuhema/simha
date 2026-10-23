# Form — paket `setting`

28 form · commit `2e695e7`.

| Dialog (judul / kelas) | Menu | Tombol | Klik kanan | Hak (isCek) | Tulis | Baca | File |
|---|---|---|---|---|---|---|---|
| <a id="dlgadmin"></a>**Setup Admin**<br>`DlgAdmin` | T/Set Admin | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **admin** | – | `src/setting/DlgAdmin.java` |
| <a id="dlgbiayaharian"></a>**Setup Biaya Harian Inap**<br>`DlgBiayaHarian` | T/Biaya Harian | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **biaya_harian** | bangsal, kamar | `src/setting/DlgBiayaHarian.java` |
| <a id="dlgbiayasekalimasuk"></a>**Setup Biaya Inap Sekali Masuk**<br>`DlgBiayaSekaliMasuk` | T/Biaya Masuk Sekali | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **biaya_sekali** | bangsal, kamar | `src/setting/DlgBiayaSekaliMasuk.java` |
| <a id="dlgclosingkasir"></a>**Jam Closing Shift Kasir**<br>`DlgClosingKasir` | T/Closing Kasir | Simpan, Baru, Hapus, Ganti, Cetak, Keluar | – | closing_kasir | **closing_kasir** | setting | `src/setting/DlgClosingKasir.java` |
| <a id="dlgjamdietpasien"></a>**Jam Diet Pasien**<br>`DlgJamDietPasien` | T/Jam Diet Pasien | Simpan, Baru, Hapus, Ganti, Cetak, Keluar | – | jam_diet_pasien | **jam_diet_pasien** | setting | `src/setting/DlgJamDietPasien.java` |
| <a id="dlgpasswordbpjs"></a>**Setup Password BPJS**<br>`DlgPasswordBPJS` | T/Password BPJS | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **password_asuransi** | penjab | `src/setting/DlgPasswordBPJS.java` |
| <a id="dlgpenelusuranlogin"></a>**Penelusuran Login User**<br>`DlgPenelusuranLogin` | T/Tracker Login | Clear, Semua, Keluar | Filter Pemulangan Pasien | tracer_login | **kamar_inap, tracker, trackersql** | pegawai | `src/setting/DlgPenelusuranLogin.java` |
| <a id="dlgruangoperasi"></a>**Data Ruang Operasi**<br>`DlgRuangOperasi` | T/Ruang Operasi | Simpan, Baru, Hapus, Ganti, Cetak, Keluar | – | ruang_ok | **ruang_ok** | setting | `src/setting/DlgRuangOperasi.java` |
| <a id="dlgrunteks"></a>**Set Display Antrian Registrasi & Poli**<br>`DlgRunTeks` | T/Display Antrian Registrasi & Poli | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **runtext** | – | `src/setting/DlgRunTeks.java` |
| <a id="dlgrunteksapotek"></a>**Set Display Antrian Apotek**<br>`DlgRunTeksApotek` | T/Display Antrian Apotek | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **runtextapotek** | – | `src/setting/DlgRunTeksApotek.java` |
| <a id="dlgsetaplikasi"></a>**Setup Aplikasi**<br>`DlgSetAplikasi` | T/Set Aplikasi | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **setting** | – | `src/setting/DlgSetAplikasi.java` |
| <a id="dlgsetembalase"></a>**Setup Embalase & Tuslah Obat**<br>`DlgSetEmbalase` | T/Set Embalase & Tuslah | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_embalase** | – | `src/setting/DlgSetEmbalase.java` |
| <a id="dlgsetharga"></a>**Setup Harga Obat/Barang/Alkes**<br>`DlgSetHarga` | T/Set Harga Obat | Simpan, Baru, Hapus, Ganti, Keluar | Update Seluruh Harga Data Obat/Barang/Alkes | – | **databarang, set_harga_obat, setpenjualan, setpenjualanperbarang, +1** | jenis | `src/setting/DlgSetHarga.java` |
| <a id="dlgsethargakamar"></a>**Setup Harga Kamar Per Cara Bayar**<br>`DlgSetHargaKamar` | T/Set Harga Kamar | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_harga_kamar** | bangsal, kamar, penjab | `src/setting/DlgSetHargaKamar.java` |
| <a id="dlgsethargaobatralan"></a>**Setup Harga Obat, Alkes & BHP Medis di Rawat Jalan Per Cara Bayar**<br>`DlgSetHargaObatRalan` | T/Set Obat Ralan | Simpan, Baru, Hapus, Keluar | – | – | **set_harga_obat_ralan** | penjab | `src/setting/DlgSetHargaObatRalan.java` |
| <a id="dlgsethargaobatranap"></a>**Setup Harga Obat, Alkes & BHP Medis di Rawat Inap Per Cara Bayar**<br>`DlgSetHargaObatRanap` | T/Set Obat Ranap | Simpan, Baru, Hapus, Keluar | – | – | **set_harga_obat_ranap** | penjab | `src/setting/DlgSetHargaObatRanap.java` |
| <a id="dlgsethargatoko"></a>**Setup Harga Barang Toko / Minimarket / Koperasi**<br>`DlgSetHargaToko` | T/Set Harga Toko | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **tokosetharga** | – | `src/setting/DlgSetHargaToko.java` |
| <a id="dlgsetinputparsial"></a>**Setup Cara Bayar Yang Bisa Menggunakan Billing Parsial Rawat Jalan**<br>`DlgSetInputParsial` | T/Set Input Parsial | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_input_parsial** | penjab | `src/setting/DlgSetInputParsial.java` |
| <a id="dlgsetkamarinap"></a>**Setup Kamar Inap**<br>`DlgSetKamarInap` | T/Set Kamar Inap | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_jam_minimal** | – | `src/setting/DlgSetKamarInap.java` |
| <a id="dlgsetketerlambatan"></a>**Setup Keterlambatan Presensi**<br>`DlgSetKeterlambatan` | T/Set Keterlambatan Presensi | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_keterlambatan** | – | `src/setting/DlgSetKeterlambatan.java` |
| <a id="dlgsetnota"></a>**Setup Billing**<br>`DlgSetNota` | T/Set Billing | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_nota, set_service_ranap, set_service_ranap_piutang** | – | `src/setting/DlgSetNota.java` |
| <a id="dlgsetotolokasi"></a>**Setup Otomatis Lokasi Stok Obat**<br>`DlgSetOtoLokasi` | T/Set Oto Lokasi | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_depo_ralan, set_depo_ranap, set_lokasi** | bangsal, poliklinik | `src/setting/DlgSetOtoLokasi.java` |
| <a id="dlgsetotoralan"></a>**Setup Tindakan Otomatis Ralan**<br>`DlgSetOtoRalan` | T/Set Oto Ralan | Simpan, Baru, Hapus, Cetak, Keluar | – | – | **set_otomatis_tindakan_ralan, set_otomatis_tindakan_ralan_dokterpetugas, set_otomatis_tindakan_ralan_petugas** | dokter, jns_perawatan, penjab, setting | `src/setting/DlgSetOtoRalan.java` |
| <a id="dlgsetpenjablab"></a>**Setup Penanggung Jawab Unit Penunjang**<br>`DlgSetPenjabLab` | T/Set P.J. Unit Penunjang | Simpan, Baru, Hapus, Ganti, Keluar | – | – | **set_pjlab** | dokter | `src/setting/DlgSetPenjabLab.java` |
| <a id="dlgsetrm"></a>**Setup Rekam Medis**<br>`DlgSetRM` | T/Set RM | Simpan, Hapus, Keluar | – | – | **set_alamat_pasien, set_kelengkapan_data_pasien, set_no_rkm_medis, set_tni_polri, +3** | – | `src/setting/DlgSetRM.java` |
| <a id="dlgsettarif"></a>**Setup Penggunaan Tarif Ranap, Ralan & Operasi**<br>`DlgSetTarif` | T/Set Penggunaan Tarif | Simpan, Baru, Ganti, Hapus, Keluar | – | – | **set_tarif** | – | `src/setting/DlgSetTarif.java` |
| <a id="dlguser"></a>**Setup User**<br>`DlgUser` | T/Set User | Simpan, Baru, Hapus, Ganti, Cetak, Keluar | Copy Hak Akses; Set Personal | – | **temporary, user** | dokter, jabatan, petugas, spesialis | `src/setting/DlgUser.java` |
| <a id="dlgvakum"></a>**Vakum Table**<br>`DlgVakum` | T/Vakum Table | Keluar, Hapus | Hilangkan Centang; Centang Semua | – | – | – | `src/setting/DlgVakum.java` |

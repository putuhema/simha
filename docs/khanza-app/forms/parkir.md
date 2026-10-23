# Form — paket `parkir`

3 form · commit `2e695e7`.

| Dialog (judul / kelas) | Menu | Tombol | Klik kanan | Hak (isCek) | Tulis | Baca | File |
|---|---|---|---|---|---|---|---|
| <a id="dlgparkirbarcode"></a>**Barcode Kartu Parkir**<br>`DlgParkirBarcode` | H/Barcode Parkir | Simpan, Baru, Hapus, Ganti, Cetak, Keluar | – | parkir_barcode | **parkir_barcode** | dokter, setting | `src/parkir/DlgParkirBarcode.java` |
| <a id="dlgparkirjenis"></a>**Jenis Parkir**<br>`DlgParkirJenis` | H/Jenis Parkir | Simpan, Baru, Hapus, Ganti, Keluar | – | parkir_jenis | **parkir_jenis** | – | `src/parkir/DlgParkirJenis.java` |
| <a id="dlgparkirmasuk"></a>**Transaksi Parkir Masuk**<br>`DlgParkirMasuk` | H/Parkir Masuk | Hapus, Cetak, Semua, Keluar | – | jml2 parkir_in kode | – | bangsal, dokter, kabupaten, kamar, kamar_inap, +8 | `src/parkir/DlgParkirMasuk.java` |

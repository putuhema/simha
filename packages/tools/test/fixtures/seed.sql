-- Synthetic test data. Every name, number and code here is made up.
-- Loaded into a throwaway database after khanza-schema.sql.
--
-- Scenarios:
--   2026/10/20/000001  RM 000001 inpatient, normal: one active room (MEL-01).
--   2026/10/21/000002  RM 000002 inpatient with TWO active kamar_inap rows (a typical bug).
--   2026/10/01/000003  RM 000001 outpatient at poli gigi, paid, nota closed, SEP + surat kontrol.
--   2026/09/15/000004  RM 000001 finished inpatient stay: moved Melati -> Mawar, nota closed.
--   2026/10/22/000005  RM 000003 outpatient, still open, not billed.

-- Non-strict so columns the tests don't care about get their implicit defaults.
SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION';

INSERT INTO penjab (kd_pj, png_jawab) VALUES
  ('BPJ', 'BPJS KESEHATAN'),
  ('UMU', 'UMUM');

INSERT INTO poliklinik (kd_poli, nm_poli, status) VALUES
  ('U0001', 'Poli Umum', '1'),
  ('GIG', 'Poli Gigi', '1');

INSERT INTO dokter (kd_dokter, nm_dokter, jk, no_telp, status) VALUES
  ('D001', 'dr. Andi Fiktif', 'L', '081200000001', '1'),
  ('D002', 'drg. Sari Fiktif', 'P', '081200000002', '1');

INSERT INTO bangsal (kd_bangsal, nm_bangsal, status) VALUES
  ('MEL', 'Melati', '1'),
  ('MAW', 'Mawar', '1');

INSERT INTO kamar (kd_kamar, kd_bangsal, trf_kamar, status, kelas, statusdata) VALUES
  ('MEL-01', 'MEL', 300000, 'ISI', 'Kelas 2', '1'),
  ('MEL-02', 'MEL', 300000, 'ISI', 'Kelas 2', '1'),
  ('MAW-01', 'MAW', 450000, 'ISI', 'Kelas 1', '1'),
  ('MAW-02', 'MAW', 450000, 'ISI', 'Kelas 1', '1'),       -- marked ISI but nobody is in it
  ('MAW-03', 'MAW', 450000, 'KOSONG', 'Kelas 1', '1'),
  ('MAW-04', 'MAW', 450000, 'DIBERSIHKAN', 'Kelas 1', '1');

INSERT INTO pasien (no_rkm_medis, nm_pasien, no_ktp, jk, tmp_lahir, tgl_lahir, alamat, no_tlp, umur, kd_pj, no_peserta, tgl_daftar) VALUES
  ('000001', 'BUDI SANTOSO', '5171000000000001', 'L', 'DENPASAR', '1980-01-02', 'JL. FIKTIF NO. 1', '081300000001', '46 Th', 'BPJ', '0000000000001', '2020-01-01'),
  ('000002', 'SITI AMINAH', '5171000000000002', 'P', 'TABANAN', '1975-05-06', 'JL. FIKTIF NO. 2', '081300000002', '51 Th', 'BPJ', '0000000000002', '2021-02-03'),
  ('000003', 'BUDI_HARTONO', '5171000000000003', 'L', 'GIANYAR', '1990-07-08', 'JL. FIKTIF NO. 3', '081300000003', '36 Th', 'UMU', NULL, '2022-03-04'),
  ('000004', 'WAYAN 100% SEHAT', '5171000000000004', 'L', 'BADUNG', '2000-09-10', 'JL. FIKTIF NO. 4', '081300000004', '26 Th', 'UMU', NULL, '2023-04-05');

INSERT INTO reg_periksa (no_reg, no_rawat, tgl_registrasi, jam_reg, kd_dokter, no_rkm_medis, kd_poli, p_jawab, almt_pj, hubunganpj, biaya_reg, stts, stts_daftar, status_lanjut, kd_pj, umurdaftar, sttsumur, status_bayar, status_poli) VALUES
  ('001', '2026/10/20/000001', '2026-10-20', '09:00:00', 'D001', '000001', 'U0001', 'ISTRI', 'JL. FIKTIF NO. 1', 'ISTRI', 10000, 'Dirawat', 'Lama', 'Ranap', 'BPJ', 46, 'Th', 'Belum Bayar', 'Lama'),
  ('002', '2026/10/21/000002', '2026-10-21', '07:30:00', 'D001', '000002', 'U0001', 'ANAK', 'JL. FIKTIF NO. 2', 'ANAK', 10000, 'Dirawat', 'Lama', 'Ranap', 'BPJ', 51, 'Th', 'Belum Bayar', 'Lama'),
  ('003', '2026/10/01/000003', '2026-10-01', '08:15:00', 'D002', '000001', 'GIG', 'DIRI SENDIRI', 'JL. FIKTIF NO. 1', 'DIRI SENDIRI', 10000, 'Sudah', 'Lama', 'Ralan', 'BPJ', 46, 'Th', 'Sudah Bayar', 'Lama'),
  ('004', '2026/09/15/000004', '2026-09-15', '10:00:00', 'D001', '000001', 'U0001', 'ISTRI', 'JL. FIKTIF NO. 1', 'ISTRI', 10000, 'Sudah', 'Lama', 'Ranap', 'BPJ', 46, 'Th', 'Sudah Bayar', 'Lama'),
  ('005', '2026/10/22/000005', '2026-10-22', '08:00:00', 'D002', '000003', 'GIG', 'DIRI SENDIRI', 'JL. FIKTIF NO. 3', 'DIRI SENDIRI', 10000, 'Belum', 'Baru', 'Ralan', 'UMU', 36, 'Th', 'Belum Bayar', 'Baru');

INSERT INTO dpjp_ranap (no_rawat, kd_dokter) VALUES
  ('2026/10/20/000001', 'D001'),
  ('2026/10/21/000002', 'D001');

-- Active rows use stts_pulang '-' and tgl_keluar '0000-00-00', like our live data.
INSERT INTO kamar_inap (no_rawat, kd_kamar, trf_kamar, diagnosa_awal, diagnosa_akhir, tgl_masuk, jam_masuk, tgl_keluar, jam_keluar, lama, ttl_biaya, stts_pulang) VALUES
  ('2026/10/20/000001', 'MEL-01', 300000, 'DEMAM', '', '2026-10-20', '10:00:00', '0000-00-00', '00:00:00', 2, 600000, '-'),
  ('2026/10/21/000002', 'MEL-02', 300000, 'DIARE', '', '2026-10-21', '08:00:00', '0000-00-00', '00:00:00', 1, 300000, '-'),
  ('2026/10/21/000002', 'MAW-01', 450000, 'DIARE', '', '2026-10-21', '14:00:00', '0000-00-00', '00:00:00', 1, 450000, '-'),
  ('2026/09/15/000004', 'MEL-01', 300000, 'TIFOID', 'TIFOID', '2026-09-15', '11:00:00', '2026-09-17', '09:00:00', 2, 600000, 'Pindah Kamar'),
  ('2026/09/15/000004', 'MAW-03', 450000, 'TIFOID', 'TIFOID', '2026-09-17', '09:00:00', '2026-09-20', '12:00:00', 3, 1350000, 'Membaik');

INSERT INTO jns_perawatan (kd_jenis_prw, nm_perawatan, kd_kategori, total_byrdr, total_byrpr, total_byrdrpr, kd_pj, kd_poli, status) VALUES
  ('RJ001', 'Cabut Gigi', 'KT01', 150000, 0, 150000, 'BPJ', 'GIG', '1'),
  ('RJ002', 'Tambal Gigi', 'KT01', 120000, 0, 120000, 'BPJ', 'GIG', '1'),
  ('RJ003', 'Pasang Infus', 'KT02', 0, 50000, 50000, 'BPJ', 'U0001', '1');

INSERT INTO jns_perawatan_inap (kd_jenis_prw, nm_perawatan, kd_kategori, total_byrdr, total_byrpr, total_byrdrpr, kd_pj, kd_bangsal, status, kelas) VALUES
  ('RI001', 'Visite Dokter', 'KT03', 75000, 0, 75000, 'BPJ', 'MEL', '1', 'Kelas 2'),
  ('RI002', 'Ganti Infus', 'KT02', 0, 25000, 25000, 'BPJ', 'MEL', '1', 'Kelas 2'),
  ('RI003', 'Rawat Luka', 'KT02', 50000, 30000, 80000, 'BPJ', 'MAW', '1', 'Kelas 1');

INSERT INTO rawat_jl_pr (no_rawat, kd_jenis_prw, nip, tgl_perawatan, jam_rawat, material, bhp, tarif_tindakanpr, kso, menejemen, biaya_rawat, stts_bayar) VALUES
  ('2026/10/01/000003', 'RJ003', 'P001', '2026-10-01', '08:30:00', 0, 0, 50000, 0, 0, 50000, 'Sudah');
INSERT INTO rawat_jl_dr (no_rawat, kd_jenis_prw, kd_dokter, tgl_perawatan, jam_rawat, material, bhp, tarif_tindakandr, kso, menejemen, biaya_rawat, stts_bayar) VALUES
  ('2026/10/01/000003', 'RJ001', 'D002', '2026-10-01', '08:40:00', 0, 0, 150000, 0, 0, 150000, 'Sudah'),
  ('2026/10/22/000005', 'RJ002', 'D002', '2026-10-22', '08:20:00', 0, 0, 120000, 0, 0, 120000, 'Belum');
INSERT INTO rawat_jl_drpr (no_rawat, kd_jenis_prw, kd_dokter, nip, tgl_perawatan, jam_rawat, material, bhp, tarif_tindakandr, tarif_tindakanpr, kso, menejemen, biaya_rawat, stts_bayar) VALUES
  ('2026/10/01/000003', 'RJ002', 'D002', 'P001', '2026-10-01', '08:50:00', 0, 0, 100000, 20000, 0, 0, 120000, 'Sudah');

INSERT INTO rawat_inap_pr (no_rawat, kd_jenis_prw, nip, tgl_perawatan, jam_rawat, material, bhp, tarif_tindakanpr, kso, menejemen, biaya_rawat) VALUES
  ('2026/10/20/000001', 'RI002', 'P001', '2026-10-20', '12:00:00', 0, 0, 25000, 0, 0, 25000),
  ('2026/10/20/000001', 'RI002', 'P001', '2026-10-21', '12:00:00', 0, 0, 25000, 0, 0, 25000);
INSERT INTO rawat_inap_dr (no_rawat, kd_jenis_prw, kd_dokter, tgl_perawatan, jam_rawat, material, bhp, tarif_tindakandr, kso, menejemen, biaya_rawat) VALUES
  ('2026/10/20/000001', 'RI001', 'D001', '2026-10-21', '09:00:00', 0, 0, 75000, 0, 0, 75000);
INSERT INTO rawat_inap_drpr (no_rawat, kd_jenis_prw, kd_dokter, nip, tgl_perawatan, jam_rawat, material, bhp, tarif_tindakandr, tarif_tindakanpr, kso, menejemen, biaya_rawat) VALUES
  ('2026/09/15/000004', 'RI003', 'D001', 'P001', '2026-09-18', '10:00:00', 0, 0, 50000, 30000, 0, 0, 80000);

INSERT INTO nota_jalan (no_rawat, no_nota, tanggal, jam) VALUES
  ('2026/10/01/000003', '2026/10/01/RJ0001', '2026-10-01', '09:30:00');
INSERT INTO nota_inap (no_rawat, no_nota, tanggal, jam, Uang_Muka) VALUES
  ('2026/09/15/000004', '2026/09/20/RI0001', '2026-09-20', '13:00:00', 0);

INSERT INTO bridging_sep (no_sep, no_rawat, tglsep, tglrujukan, no_rujukan, kdppkrujukan, nmppkrujukan, kdppkpelayanan, nmppkpelayanan, jnspelayanan, catatan, diagawal, nmdiagnosaawal, kdpolitujuan, nmpolitujuan, klsrawat, user, nomr, nama_pasien, tanggal_lahir, peserta, jkel, no_kartu, tglpulang, notelep, noskdp, kddpjp, nmdpdjp, tujuankunjungan) VALUES
  ('0001R0011026V000001', '2026/10/01/000003', '2026-10-01', '2026-09-28', 'RJK/0001', '0001P001', 'PUSKESMAS FIKTIF', '0001R001', 'RS FIKTIF', '2', '', 'K02.1', 'Karies dentin', 'GIG', 'GIGI', '3', 'admin', '000001', 'BUDI SANTOSO', '1980-01-02', 'PBI', 'L', '0000000000001', '2026-10-01 10:00:00', '081300000001', 'SKDP/0001', 'B001', 'drg. Sari Fiktif', '0');

INSERT INTO bridging_surat_kontrol_bpjs (no_sep, tgl_surat, no_surat, tgl_rencana, kd_dokter_bpjs, nm_dokter_bpjs, kd_poli_bpjs, nm_poli_bpjs) VALUES
  ('0001R0011026V000001', '2026-10-01', '0001R0011026K000001', '2026-10-15', 'B001', 'drg. Sari Fiktif', 'GIG', 'GIGI');

-- Patient documents (dokumenPasien): CPPT/SOAP, diagnoses, resume, lab, radiology, drugs. All fictional.
INSERT INTO setting (nama_instansi, alamat_instansi, kabupaten, propinsi, kontak, email, aktifkan, kode_ppk, logo) VALUES
  ('RSUD FIKTIF SEHAT', 'Jl. Contoh No. 1', 'Kota Contoh', 'Provinsi Contoh', '0361-000000', 'rs@contoh.test', 'Yes', '0000R000', x'');

INSERT INTO petugas (nip, nama, jk, status) VALUES
  ('P001', 'Ns. Rina Fiktif', 'P', '1'),
  ('P002', 'Ns. Dewa Fiktif', 'L', '1');

INSERT INTO penyakit (kd_penyakit, nm_penyakit, status, validcode, accpdx, asterisk, im) VALUES
  ('A09', 'Diare dan gastroenteritis', 'Menular', '1', 'Y', '0', '0'),
  ('A01.0', 'Demam tifoid', 'Menular', '1', 'Y', '0', '0'),
  ('R50.9', 'Demam, tidak spesifik', 'Tidak Menular', '1', 'Y', '0', '0'),
  ('K02.1', 'Karies dentin', 'Tidak Menular', '1', 'Y', '0', '0'),
  ('E86', 'Dehidrasi', 'Tidak Menular', '1', 'N', '0', '0');

INSERT INTO diagnosa_pasien (no_rawat, kd_penyakit, status, prioritas, status_penyakit) VALUES
  ('2026/10/21/000002', 'A09', 'Ranap', 1, 'Baru'),
  ('2026/10/21/000002', 'E86', 'Ranap', 2, 'Baru'),
  ('2026/10/20/000001', 'R50.9', 'Ranap', 1, 'Baru'),
  ('2026/10/01/000003', 'K02.1', 'Ralan', 1, 'Baru'),
  ('2026/09/15/000004', 'A01.0', 'Ranap', 1, 'Baru');

INSERT INTO pemeriksaan_ranap (no_rawat, tgl_perawatan, jam_rawat, suhu_tubuh, tensi, nadi, respirasi, tinggi, berat, spo2, gcs, kesadaran, keluhan, pemeriksaan, alergi, penilaian, rtl, instruksi, evaluasi, nip) VALUES
  ('2026/10/21/000002', '2026-10-21', '09:00:00', '37.8', '100/70', '102', '22', '155', '52', '97', '15', 'Compos Mentis',
   'BAB cair 6x sejak kemarin, mual, lemas.', 'Turgor kulit menurun, bising usus meningkat.', 'Tidak ada',
   'Diare akut dengan dehidrasi ringan-sedang.', 'Infus RL 20 tpm, oralit, cek darah lengkap.', 'Observasi tanda vital tiap 4 jam.', '-', 'D001'),
  ('2026/10/21/000002', '2026-10-21', '15:00:00', '37.4', '110/70', '96', '20', NULL, NULL, '98', '15', 'Compos Mentis',
   'BAB cair 2x, mual berkurang.', 'Infus lancar, akral hangat.', 'Tidak ada',
   'Masalah kekurangan volume cairan teratasi sebagian.', 'Lanjutkan intervensi, motivasi minum.', 'Catat intake dan output.', 'Pasien lebih segar.', 'P001'),
  ('2026/10/21/000002', '2026-10-22', '07:00:00', '36.9', '110/80', '88', '20', NULL, NULL, '98', '15', 'Compos Mentis',
   'Tidak BAB cair sejak malam.', 'Keadaan umum baik.', 'Tidak ada',
   'Diare membaik.', 'Rencana pulang besok bila stabil.', 'Lepas infus bila intake baik.', 'Membaik.', 'P002'),
  ('2026/09/15/000004', '2026-09-15', '12:00:00', '39.1', '110/70', '104', '22', '168', '60', '97', '15', 'Compos Mentis',
   'Demam 7 hari, terutama malam hari.', 'Lidah kotor, nyeri tekan epigastrium.', 'Tidak ada',
   'Suspek demam tifoid.', 'Cek widal, antibiotik empiris.', 'Kompres hangat bila demam.', '-', 'D001');

INSERT INTO pemeriksaan_ralan (no_rawat, tgl_perawatan, jam_rawat, suhu_tubuh, tensi, nadi, respirasi, tinggi, berat, spo2, gcs, kesadaran, keluhan, pemeriksaan, alergi, rtl, penilaian, instruksi, evaluasi, nip) VALUES
  ('2026/10/01/000003', '2026-10-01', '08:30:00', '36.6', '120/80', '80', '18', '170', '68', '99', '15', 'Compos Mentis',
   'Gigi geraham kanan bawah ngilu saat minum dingin.', 'Karies dentin gigi 46.', 'Tidak ada',
   'Tambal komposit gigi 46.', 'Karies dentin 46.', 'Kontrol bila nyeri.', '-', 'D002');

INSERT INTO resume_pasien_ranap (no_rawat, kd_dokter, diagnosa_awal, alasan, keluhan_utama, pemeriksaan_fisik, jalannya_penyakit, pemeriksaan_penunjang, hasil_laborat, tindakan_dan_operasi, obat_di_rs, diagnosa_utama, kd_diagnosa_utama, diagnosa_sekunder, kd_diagnosa_sekunder, diagnosa_sekunder2, kd_diagnosa_sekunder2, diagnosa_sekunder3, kd_diagnosa_sekunder3, diagnosa_sekunder4, kd_diagnosa_sekunder4, prosedur_utama, kd_prosedur_utama, prosedur_sekunder, kd_prosedur_sekunder, prosedur_sekunder2, kd_prosedur_sekunder2, prosedur_sekunder3, kd_prosedur_sekunder3, alergi, diet, lab_belum, edukasi, cara_keluar, keadaan, dilanjutkan, obat_pulang) VALUES
  ('2026/09/15/000004', 'D001', 'Observasi febris', 'Demam lama', 'Demam 7 hari', 'Lidah kotor, nyeri epigastrium', 'Demam turun hari ke-3 dengan antibiotik.', 'Widal positif', 'Leukosit normal', '-', 'Seftriakson, parasetamol', 'Demam tifoid', 'A01.0', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Tidak ada', 'Lunak', '-', 'Makan bertahap, cuci tangan', 'Atas Persetujuan Dokter', 'Membaik', 'Kembali Ke RS', 'Sefiksim 2x200 mg');

INSERT INTO jns_perawatan_lab (kd_jenis_prw, nm_perawatan, bhp, tarif_perujuk, tarif_tindakan_dokter, kd_pj, status, kelas, kategori) VALUES
  ('LAB01', 'Darah Lengkap', 0, 0, 0, 'BPJ', '1', '-', 'PK');

INSERT INTO template_laboratorium (kd_jenis_prw, id_template, Pemeriksaan, satuan, nilai_rujukan_ld, nilai_rujukan_la, nilai_rujukan_pd, nilai_rujukan_pa, bagian_rs, bhp, bagian_perujuk, bagian_dokter, bagian_laborat, biaya_item, urut) VALUES
  ('LAB01', 1, 'Hemoglobin', 'g/dL', '13-17', '13-17', '12-15', '12-15', 0, 0, 0, 0, 0, 0, 1),
  ('LAB01', 2, 'Leukosit', '10^3/uL', '4-10', '4-10', '4-10', '4-10', 0, 0, 0, 0, 0, 0, 2);

INSERT INTO periksa_lab (no_rawat, nip, kd_jenis_prw, tgl_periksa, jam, dokter_perujuk, bagian_rs, bhp, tarif_perujuk, tarif_tindakan_dokter, tarif_tindakan_petugas, biaya, kd_dokter, kategori) VALUES
  ('2026/10/21/000002', 'P001', 'LAB01', '2026-10-21', '10:00:00', 'D001', 0, 0, 0, 0, 0, 0, 'D001', 'PK');

INSERT INTO detail_periksa_lab (no_rawat, kd_jenis_prw, tgl_periksa, jam, id_template, nilai, nilai_rujukan, keterangan, bagian_rs, bhp, bagian_perujuk, bagian_dokter, bagian_laborat, biaya_item) VALUES
  ('2026/10/21/000002', 'LAB01', '2026-10-21', '10:00:00', 1, '14.2', '12-15', '', 0, 0, 0, 0, 0, 0),
  ('2026/10/21/000002', 'LAB01', '2026-10-21', '10:00:00', 2, '12.8', '4-10', 'H', 0, 0, 0, 0, 0, 0);

INSERT INTO hasil_radiologi (no_rawat, tgl_periksa, jam, hasil) VALUES
  ('2026/09/15/000004', '2026-09-16', '09:00:00', 'Foto thorax PA: cor dan pulmo dalam batas normal.');

INSERT INTO databarang (kode_brng, nama_brng, kode_satbesar, kode_sat, dasar, isi, kapasitas, status) VALUES
  ('B001', 'Paracetamol 500 mg', 'BOX', 'TAB', 500, 1, 1, '1'),
  ('B002', 'Oralit', 'BOX', 'SAC', 1000, 1, 1, '1');

INSERT INTO detail_pemberian_obat (tgl_perawatan, jam, no_rawat, kode_brng, h_beli, biaya_obat, jml, total, status, no_batch, no_faktur) VALUES
  ('2026-10-21', '09:30:00', '2026/10/21/000002', 'B001', 300, 500, 6, 3000, 'Ranap', '-', '-'),
  ('2026-10-21', '09:30:00', '2026/10/21/000002', 'B002', 600, 1000, 4, 4000, 'Ranap', '-', '-');

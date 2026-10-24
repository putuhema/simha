-- SIMRS login tables for the test database only.
--
-- The real `user` table has 1,100+ right columns; tests only need the ones
-- Simha maps to a feature. The `enum('true','false')` type matches the
-- hospital's Khanza so the login code is tested against the same values.
-- Loaded by test-db.ts after khanza-schema.sql, before seed.sql.

DROP TABLE IF EXISTS `admin`;
CREATE TABLE `admin` (
  `usere` varbinary(700) NOT NULL,
  `passworde` text NOT NULL,
  PRIMARY KEY (`usere`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id_user` varchar(700) NOT NULL,
  `password` text NOT NULL,
  `pasien` enum('true','false') NOT NULL DEFAULT 'false',
  `registrasi` enum('true','false') NOT NULL DEFAULT 'false',
  `tindakan_ralan` enum('true','false') NOT NULL DEFAULT 'false',
  `tindakan_ranap` enum('true','false') NOT NULL DEFAULT 'false',
  `kamar_inap` enum('true','false') NOT NULL DEFAULT 'false',
  `periksa_radiologi` enum('true','false') NOT NULL DEFAULT 'false',
  `berkas_digital_perawatan` enum('true','false') NOT NULL DEFAULT 'false',
  `data_resume_pasien` enum('true','false') NOT NULL DEFAULT 'false',
  `bpjs_surat_kontrol` enum('true','false') NOT NULL DEFAULT 'false',
  `skdp_bpjs` enum('true','false') NOT NULL DEFAULT 'false',
  PRIMARY KEY (`id_user`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- Small stand-in for the employee master; the real one is large. Simha reads
-- pegawai.nama (by NIK) and petugas.nama (by NIP) for the display name.
DROP TABLE IF EXISTS `pegawai`;
CREATE TABLE `pegawai` (
  `nik` varchar(20) NOT NULL,
  `nama` varchar(100) NOT NULL,
  PRIMARY KEY (`nik`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- E2E account: a Khanza Admin Utama (all rights) with a readable name.
INSERT INTO admin (usere, passworde) VALUES
  (AES_ENCRYPT('it-budi', 'nur'), AES_ENCRYPT('rahasia-uji-123', 'windi'));

INSERT INTO pegawai (nik, nama) VALUES
  ('it-budi', 'Budi Santika'),
  ('it-terbatas', 'Ns. Terbatas Fiktif');

-- Staff account with only the outpatient CPPT right, for the permission tests.
INSERT INTO user (id_user, password, tindakan_ralan) VALUES
  (AES_ENCRYPT('it-terbatas', 'nur'), AES_ENCRYPT('rahasia-uji-123', 'windi'), 'true');

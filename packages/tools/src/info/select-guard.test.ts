import { describe, expect, it } from "vitest";
import { checkSelect, MAX_QUERY_ROWS, QueryRejected, referencedTables } from "./select-guard.ts";
import { isCredentialTable, protectedColumn } from "./sensitive.ts";

const COLUMNS: Record<string, ReadonlyArray<string>> = {
  pasien: ["no_rkm_medis", "nm_pasien", "no_ktp", "alamat", "no_tlp", "kd_pj"],
  reg_periksa: ["no_rawat", "no_rkm_medis", "kd_poli", "tgl_registrasi", "almt_pj"],
  poliklinik: ["kd_poli", "nm_poli"],
};
const options = { database: "sik", columnsOf: (t: string) => COLUMNS[t] };
const check = (sql: string) => checkSelect(sql, options);
const rejection = (sql: string) => {
  try {
    check(sql);
  } catch (error) {
    if (error instanceof QueryRejected) return error.message;
    throw error;
  }
  throw new Error(`expected rejection: ${sql}`);
};

describe("checkSelect: only one SELECT", () => {
  it.each([
    ["UPDATE pasien SET nm_pasien = 'x' WHERE no_rkm_medis = '1'", /Hanya query SELECT/],
    ["DELETE FROM pasien", /Hanya query SELECT/],
    ["INSERT INTO poliklinik (kd_poli) VALUES ('X')", /Hanya query SELECT/],
    ["DROP TABLE pasien", /SELECT|tidak bisa dibaca/],
    ["SHOW TABLES", /Hanya query SELECT/],
    ["CALL hapus_semua()", /Hanya query SELECT/],
    ["SET @a = 1", /Hanya query SELECT/],
    ["DO SLEEP(1)", /tidak bisa dibaca/],
    ["SELECT 1; DELETE FROM pasien", /Hanya boleh satu query/],
    ["SELECT 1; SELECT 2", /Hanya boleh satu query/],
    ["SELECT nm_poli FROM poliklinik -- komentar", /Komentar/],
    ["SELECT /*! 1 */ nm_poli FROM poliklinik", /Komentar/],
    ["SELECT nm_poli FROM poliklinik # x", /Komentar/],
    ["SELECT nm_poli FROM poliklinik INTO OUTFILE '/tmp/x'", /INTO/],
    ["SELECT nm_poli FROM poliklinik FOR UPDATE", /FOR UPDATE/],
    ["SELECT @@version", /Variabel/],
    ["SELECT LOAD_FILE('/etc/passwd')", /LOAD_FILE/],
    ["SELECT nm_poli FROM poliklinik WHERE SLEEP(5) = 0", /SLEEP/],
    ["SELECT * FROM mysql.user", /database Khanza/],
    ["SELECT TABLE_NAME FROM information_schema.TABLES", /database Khanza/],
    ["SELECT id_user FROM user", /kredensial/],
    ["SELECT usere FROM admin", /kredensial/],
    ["SELECT nama FROM set_akun_bankbri", /kredensial/],
  ])("rejects %s", (sql, message) => {
    expect(rejection(sql)).toMatch(message);
  });

  it("explains how to fix aliases the parser treats as keywords", () => {
    expect(rejection("SELECT stts AS status FROM reg_periksa")).toMatch(/backtick/);
    expect(() => check("SELECT stts AS `status` FROM reg_periksa")).not.toThrow();
  });

  it("ignores comment characters and semicolons inside strings", () => {
    expect(check("SELECT nm_poli FROM poliklinik WHERE nm_poli = 'a -- b # c; d'").limitAdded).toBe(true);
  });

  it("accepts WITH, UNION, window functions and a trailing semicolon", () => {
    expect(() => check("WITH x AS (SELECT kd_poli FROM poliklinik) SELECT kd_poli FROM x;")).not.toThrow();
    expect(() => check("SELECT kd_poli FROM poliklinik UNION SELECT kd_poli FROM reg_periksa")).not.toThrow();
    expect(() => check("SELECT kd_poli, COUNT(*) OVER (PARTITION BY kd_poli) FROM reg_periksa")).not.toThrow();
    expect(() => check("SELECT nm_poli FROM sik.poliklinik")).not.toThrow();
  });
});

describe("checkSelect: protected columns", () => {
  it.each([
    "SELECT no_ktp FROM pasien",
    "SELECT p.`no_ktp` FROM pasien AS p",
    "SELECT nm_pasien, no_tlp FROM pasien",
    "SELECT CONCAT(nm_pasien, ' ', alamat) FROM pasien",
    "SELECT MAX(no_ktp) FROM pasien",
    "SELECT GROUP_CONCAT(no_tlp) FROM pasien",
    "SELECT r.almt_pj FROM reg_periksa r",
    "SELECT x FROM (SELECT no_ktp AS x FROM pasien) t",
    "WITH t AS (SELECT alamat FROM pasien) SELECT * FROM t",
    "SELECT nm_poli, (SELECT no_tlp FROM pasien LIMIT 1) FROM poliklinik",
    "SELECT nm_poli FROM poliklinik UNION SELECT no_ktp FROM pasien",
  ])("rejects %s", (sql) => {
    expect(rejection(sql)).toMatch(/data pribadi/);
  });

  it.each(["SELECT * FROM pasien", "SELECT p.* FROM pasien p JOIN reg_periksa r USING (no_rkm_medis)", "SELECT * FROM reg_periksa"])(
    "rejects %s because the table has protected columns",
    (sql) => {
      expect(rejection(sql)).toMatch(/SELECT \* dari tabel (pasien|reg_periksa)/);
    },
  );

  it("allows protected columns in WHERE, JOIN, GROUP BY and COUNT()", () => {
    expect(() => check("SELECT COUNT(*) AS n, COUNT(DISTINCT no_ktp) AS ktp FROM pasien WHERE no_tlp LIKE '08%'")).not.toThrow();
    expect(() => check("SELECT kd_pj, COUNT(*) FROM pasien GROUP BY kd_pj, alamat ORDER BY alamat")).not.toThrow();
    expect(() => check("SELECT nm_pasien FROM pasien p JOIN reg_periksa r ON r.almt_pj = p.alamat")).not.toThrow();
  });

  it("allows * on tables without protected columns, and on derived tables that are checked themselves", () => {
    expect(() => check("SELECT * FROM poliklinik")).not.toThrow();
    expect(() => check("SELECT t.* FROM (SELECT nm_pasien FROM pasien) t")).not.toThrow();
    expect(() => check("WITH t AS (SELECT kd_poli FROM reg_periksa) SELECT * FROM t")).not.toThrow();
  });

  it("knows Khanza's nik is the employee number, not the national ID", () => {
    expect(protectedColumn("nik")).toBeUndefined();
    expect(protectedColumn("no_ktp")).toBe("NIK/KTP");
    expect(protectedColumn("passworde")).toBeDefined();
    expect(isCredentialTable("password_asuransi")).toBe(true);
    expect(isCredentialTable("pasien")).toBe(false);
  });
});

describe("checkSelect: row limit", () => {
  it("adds LIMIT 501 when there is none, so a cut result can be detected", () => {
    const checked = check("SELECT nm_poli FROM poliklinik");
    expect(checked).toMatchObject({ limitAdded: true, tables: ["poliklinik"] });
    expect(checked.sql).toBe(`SELECT nm_poli FROM poliklinik\nLIMIT ${MAX_QUERY_ROWS + 1}`);
  });

  it("keeps a LIMIT up to 500 and rejects a larger one", () => {
    expect(check("SELECT nm_poli FROM poliklinik LIMIT 10")).toMatchObject({ limitAdded: false });
    expect(check("SELECT nm_poli FROM poliklinik LIMIT 10 OFFSET 990")).toMatchObject({ limitAdded: false });
    expect(check("SELECT nm_poli FROM poliklinik LIMIT 990, 10")).toMatchObject({ limitAdded: false });
    expect(rejection("SELECT nm_poli FROM poliklinik LIMIT 1000")).toMatch(/maksimal 500/);
    expect(rejection("SELECT nm_poli FROM poliklinik LIMIT 0, 1000")).toMatch(/maksimal 500/);
  });

  it("reads the LIMIT of a UNION from its last part", () => {
    expect(check("SELECT 1 UNION SELECT 2 LIMIT 5")).toMatchObject({ limitAdded: false });
    expect(check("SELECT 1 UNION SELECT 2").sql).toMatch(/LIMIT 501$/);
  });
});

describe("referencedTables", () => {
  it("lists base tables, lower case, without duplicates", () => {
    expect(referencedTables("SELECT * FROM Pasien p JOIN reg_periksa r USING (no_rkm_medis) JOIN pasien x")).toEqual([
      "pasien",
      "reg_periksa",
    ]);
  });
});

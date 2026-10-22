/**
 * What an AI-written query may not read: protected columns, credential tables
 * and dangerous functions. Built from the column names in our real schema
 * (checked Oct 2026); matched by name so it also covers the hundreds of
 * tables not listed in docs/schema.md.
 *
 * Note: in Khanza `nik` is the employee number (pegawai.nik), not the
 * national ID. The national ID is `no_ktp`, so `nik` is allowed.
 */

const PROTECTED_COLUMNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(no_ktp|no_ktppj|ktp|nik_pasien)$/, "NIK/KTP"],
  [/^(no_tlp|no_telp|no_telppj|notelp|notelep|no_hp|nohp|nomor_telepon|telepon|telp|hp)$/, "nomor telepon"],
  [/alamat|^almt_/, "alamat"],
  [/^email$/, "email"],
  [/^(no_peserta|no_kartu|nokartu|nomor_kartu)$/, "nomor kartu BPJS/asuransi"],
  [/^nm_ibu$/, "nama ibu kandung"],
  [/pass|token|secret|consumer_key|api_?key|rekening/, "kredensial atau rekening"],
];

/** Why a column is protected, or undefined when it may be selected. */
export const protectedColumn = (column: string): string | undefined =>
  PROTECTED_COLUMNS.find(([pattern]) => pattern.test(column.toLowerCase()))?.[1];

/**
 * Tables with logins, passwords or bank credentials. Never readable by AI
 * queries and hidden from lihatSkema. Also valid as a MariaDB/MySQL REGEXP.
 */
export const CREDENTIAL_TABLE_PATTERN = "^(user|users|admin|personal_pasien)$|^mlite_users|password|token|remember_me|^set_akun";

const CREDENTIAL_TABLES = new RegExp(CREDENTIAL_TABLE_PATTERN);

export const isCredentialTable = (table: string): boolean => CREDENTIAL_TABLES.test(table.toLowerCase());

/** Functions that read files, decrypt passwords, sleep or take locks. */
export const DENIED_FUNCTIONS: ReadonlySet<string> = new Set([
  "LOAD_FILE",
  "SLEEP",
  "BENCHMARK",
  "GET_LOCK",
  "RELEASE_LOCK",
  "RELEASE_ALL_LOCKS",
  "IS_FREE_LOCK",
  "IS_USED_LOCK",
  "MASTER_POS_WAIT",
  "MASTER_GTID_WAIT",
  "AES_DECRYPT",
  "DES_DECRYPT",
  "DECODE",
  "SYS_EVAL",
  "SYS_EXEC",
]);

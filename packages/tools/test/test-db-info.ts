/** Connection details for the throwaway test database, shared from global-setup.ts to tests. */
export interface TestDbInfo {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly readUser: string;
  readonly readPass: string;
  readonly writeUser: string;
  readonly writePass: string;
  readonly adminUser: string;
  readonly adminPass: string;
  readonly version: string;
}

/** Fixed name so the setup can never drop a real Khanza database. */
export const TEST_DB_NAME = "simrs_harness_test";

/** Users created with too many privileges, to test that the harness refuses them. */
export const MISCONFIGURED = {
  /** Has UPDATE: must be refused as KHANZA_DB_READ_USER. */
  readCanWrite: "harness_test_rw",
  /** Has UPDATE ON *.*: must be refused as KHANZA_DB_WRITE_USER. */
  writeGlobal: "harness_test_global",
  password: "test-misconfigured-pass",
} as const;

declare module "vitest" {
  export interface ProvidedContext {
    khanzaTestDb: TestDbInfo | null;
  }
}

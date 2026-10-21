import { Duration, Layer, Redacted } from "effect";
import { inject } from "vitest";
import { AuditLogMemory } from "../src/audit/AuditLog.ts";
import type { KhanzaConnectionOptions } from "../src/config.ts";
import { khanzaReadLayer } from "../src/khanza/KhanzaRead.ts";
import type { TestDbInfo } from "./test-db-info.ts";

/** Connection info for the throwaway test DB, or null when tests must be skipped. */
export const testDb: TestDbInfo | null = inject("khanzaTestDb");

export const connectionAs = (db: TestDbInfo, username: string, password: string): KhanzaConnectionOptions => ({
  host: db.host,
  port: db.port,
  database: db.database,
  username,
  password: Redacted.make(password),
});

/**
 * KhanzaRead on the test DB with the SELECT-only test user, plus an in-memory
 * audit log. The audit SqlClient is exposed so tests can check what was logged.
 */
export const readTestLayer = (db: TestDbInfo, timeout: Duration.Duration = Duration.seconds(5)) =>
  khanzaReadLayer({ connection: connectionAs(db, db.readUser, db.readPass), timeout }).pipe(
    Layer.provideMerge(AuditLogMemory),
  );

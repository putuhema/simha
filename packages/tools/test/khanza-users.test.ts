/**
 * The harness only accepts correctly limited database users. Runs against the
 * throwaway test database, which has correct and wrongly configured users.
 */
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { AuditLogMemory } from "../src/audit/AuditLog.ts";
import { connectKhanza } from "../src/khanza/connect.ts";
import { khanzaReadLayer } from "../src/khanza/KhanzaRead.ts";
import { KhanzaWrite, khanzaWriteLayer } from "../src/khanza/KhanzaWrite.ts";
import { connectionAs, testDb } from "./helpers.ts";
import { MISCONFIGURED } from "./test-db-info.ts";

describe.skipIf(testDb === null)("database users", () => {
  if (testDb === null) return;
  const db = testDb;

  it.effect("refuses a read user that can change data", () =>
    Effect.gen(function* () {
      const misconfigured = khanzaReadLayer({
        connection: connectionAs(db, MISCONFIGURED.readCanWrite, MISCONFIGURED.password),
        timeout: Duration.seconds(5),
      }).pipe(Layer.provide(AuditLogMemory));
      const error = yield* Effect.flip(Layer.build(misconfigured)).pipe(Effect.scoped);
      expect(error._tag).toBe("KhanzaSetupError");
      expect(error.message).toMatch(/can change data/);
    }),
  );

  it.effect("the read user's grants block writes even without our SELECT check", () =>
    Effect.gen(function* () {
      const raw = yield* connectKhanza(connectionAs(db, db.readUser, db.readPass), 1);
      const error = yield* Effect.flip(raw`UPDATE kamar SET status = 'KOSONG' WHERE kd_kamar = 'MAW-02'`);
      expect(error.reason._tag).toBe("AuthorizationError");
    }).pipe(Effect.scoped),
  );

  it.effect("accepts the limited write user", () =>
    Effect.gen(function* () {
      const write = yield* KhanzaWrite;
      const rows = yield* write.sql<{ n: number }>`SELECT COUNT(*) AS n FROM kamar`;
      expect(rows[0]?.n).toBe(6);
    }).pipe(Effect.provide(khanzaWriteLayer(connectionAs(db, db.writeUser, db.writePass)))),
  );

  it.effect("the write user cannot touch tables outside the allow-list", () =>
    Effect.gen(function* () {
      const write = yield* KhanzaWrite;
      const error = yield* Effect.flip(write.sql`DELETE FROM pasien WHERE no_rkm_medis = '000004'`);
      expect(error.reason._tag).toBe("AuthorizationError");
    }).pipe(Effect.provide(khanzaWriteLayer(connectionAs(db, db.writeUser, db.writePass)))),
  );

  it.effect("refuses a write user with privileges on every database", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Layer.build(khanzaWriteLayer(connectionAs(db, MISCONFIGURED.writeGlobal, MISCONFIGURED.password))),
      ).pipe(Effect.scoped);
      expect(error._tag).toBe("KhanzaSetupError");
    }),
  );
});

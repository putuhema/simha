/**
 * KhanzaRead safety behaviour, against the throwaway test database.
 */
import { describe, expect, layer } from "@effect/vitest";
import { Duration, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { KhanzaRead } from "../src/khanza/KhanzaRead.ts";
import { readTestLayer, testDb } from "./helpers.ts";

describe.skipIf(testDb === null)("KhanzaRead", () => {
  if (testDb === null) return;
  const db = testDb;

  layer(readTestLayer(db, Duration.seconds(1)), { excludeTestServices: true })((it) => {
    it.effect("detects the server type", () =>
      Effect.gen(function* () {
        const read = yield* KhanzaRead;
        expect(read.server.flavor).toBe(db.version.toLowerCase().includes("mariadb") ? "mariadb" : "mysql");
      }),
    );

    it.effect("refuses statements that are not SELECT, and logs the attempt", () =>
      Effect.gen(function* () {
        const read = yield* KhanzaRead;
        const error = yield* Effect.flip(read.query((sql) => sql`UPDATE kamar SET status = 'KOSONG'`));
        expect(error).toMatchObject({ _tag: "KhanzaQueryError", kind: "rejected" });
        const audit = yield* SqlClient.SqlClient;
        const rows = yield* audit<{ error: string | null }>`SELECT error FROM queries WHERE sql LIKE 'UPDATE%'`;
        expect(rows[0]?.error).toMatch(/SELECT/);
      }),
    );

    it.effect("stops slow queries on the server", () =>
      Effect.gen(function* () {
        const read = yield* KhanzaRead;
        const started = Date.now();
        const error = yield* Effect.flip(read.query((sql) => sql`SELECT SLEEP(5) AS s FROM kamar LIMIT 1`));
        expect(error).toMatchObject({ _tag: "KhanzaQueryError", kind: "timeout" });
        expect(Date.now() - started).toBeLessThan(4_000);
      }),
    );

    it.effect("returns database errors as readable messages", () =>
      Effect.gen(function* () {
        const read = yield* KhanzaRead;
        const error = yield* Effect.flip(read.query((sql) => sql`SELECT kolom_tidak_ada FROM kamar`));
        expect(error._tag).toBe("KhanzaQueryError");
        expect(error.message).toMatch(/kolom_tidak_ada/);
      }),
    );

  });

});

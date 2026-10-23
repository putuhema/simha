/**
 * Write access to Khanza through the limited write user.
 *
 * Only the approval flow (M3) uses this, after a human approves a fix. No
 * tool and no AI-facing code may depend on it.
 *
 * At startup the layer checks `SHOW GRANTS` and refuses to start if the write
 * user has privileges on every database, PROXY, or GRANT OPTION.
 */
import { Context, Effect, Layer } from "effect";
import type { SqlClient } from "effect/sql";
import { KhanzaWriteConfig, type KhanzaConnectionOptions } from "../config.ts";
import { KhanzaSetupError } from "../errors.ts";
import { connectKhanza } from "./connect.ts";
import { findGlobalPrivileges } from "./grants.ts";
import { detectServer, type ServerInfo } from "./server.ts";

export interface KhanzaWriteService {
  readonly server: ServerInfo;
  readonly sql: SqlClient.SqlClient;
}

export class KhanzaWrite extends Context.Service<KhanzaWrite, KhanzaWriteService>()("simha/KhanzaWrite") {}

const makeKhanzaWrite = Effect.fn("makeKhanzaWrite")(function* (connection: KhanzaConnectionOptions) {
  const sql: SqlClient.SqlClient = yield* connectKhanza(connection, 2);

  const [meta] = yield* sql<{ version: string }>`SELECT VERSION() AS version`;
  const grants = yield* sql.unsafe<Record<string, string>>("SHOW GRANTS");
  const tooBroad = findGlobalPrivileges(grants.map((row) => Object.values(row)[0] ?? ""));
  if (tooBroad.length > 0) {
    return yield* new KhanzaSetupError({
      message:
        `KHANZA_DB_WRITE_USER (${connection.username}) has more privileges than the fix allow-list needs, ` +
        `so Simha refuses to use it.\nGive it table-level grants only (see README.md). Grants found:\n  ${tooBroad.join("\n  ")}`,
    });
  }

  return KhanzaWrite.of({ server: detectServer(meta?.version ?? ""), sql });
});

/** Layer from explicit options (tests). */
export const khanzaWriteLayer = (connection: KhanzaConnectionOptions) =>
  Layer.effect(KhanzaWrite, makeKhanzaWrite(connection));

/** Layer from .env: KHANZA_DB_HOST/PORT/NAME, KHANZA_DB_WRITE_USER/PASS. */
export const KhanzaWriteLive = Layer.unwrap(Effect.map(KhanzaWriteConfig, khanzaWriteLayer));

import { MysqlClient } from "@effect/sql-mysql2";
import { Config } from "effect";

/** Khanza connection with the SELECT-only user, for scripts. */
export const KhanzaReadLive = MysqlClient.layerConfig({
  host: Config.String("KHANZA_DB_HOST"),
  port: Config.Port("KHANZA_DB_PORT").pipe(Config.withDefault(3306)),
  database: Config.String("KHANZA_DB_NAME"),
  username: Config.String("KHANZA_DB_READ_USER"),
  password: Config.Redacted("KHANZA_DB_READ_PASS"),
  maxConnections: Config.succeed(2),
});

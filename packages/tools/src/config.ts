/**
 * Configuration read from the environment (.env) through Effect Config.
 */
import { Config, Duration } from "effect";
import * as NodePath from "node:path";

/** Repository root (packages/tools/src -> ../../..). */
const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..", "..");

/** Connection to the Khanza MySQL/MariaDB server for one database user. */
export interface KhanzaConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: import("effect").Redacted.Redacted;
}

const khanzaServer = {
  host: Config.String("KHANZA_DB_HOST"),
  port: Config.Port("KHANZA_DB_PORT").pipe(Config.withDefault(3306)),
  database: Config.String("KHANZA_DB_NAME"),
};

/** SELECT-only user. Used by every read tool. */
export const KhanzaReadConfig: Config.Config<KhanzaConnectionOptions> = Config.all({
  ...khanzaServer,
  username: Config.String("KHANZA_DB_READ_USER"),
  password: Config.Redacted("KHANZA_DB_READ_PASS"),
});

/** Limited write user. Used only to run fixes a human approved. */
export const KhanzaWriteConfig: Config.Config<KhanzaConnectionOptions> = Config.all({
  ...khanzaServer,
  username: Config.String("KHANZA_DB_WRITE_USER"),
  password: Config.Redacted("KHANZA_DB_WRITE_PASS"),
});

/** Max run time for one read query on the Khanza server. */
export const QueryTimeoutConfig: Config.Config<Duration.Duration> = Config.Duration("KHANZA_QUERY_TIMEOUT").pipe(
  Config.withDefault(Duration.seconds(10)),
);

/**
 * SQLite file for the audit log. Relative paths are resolved from the
 * repository root, so the server, scripts and MCP server share one file.
 */
export const AuditDbPathConfig: Config.Config<string> = Config.String("AUDIT_DB_PATH").pipe(
  Config.withDefault("data/audit.sqlite"),
  Config.map((path) => (path === ":memory:" ? path : NodePath.resolve(repoRoot, path))),
);

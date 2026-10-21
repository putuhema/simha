import { Duration } from "effect";

export type ServerFlavor = "mariadb" | "mysql";

export interface ServerInfo {
  readonly flavor: ServerFlavor;
  readonly version: string;
}

/** `SELECT VERSION()` returns e.g. "12.1.2-MariaDB" or "8.0.36". */
export const detectServer = (version: string): ServerInfo => ({
  flavor: /mariadb/i.test(version) ? "mariadb" : "mysql",
  version,
});

/**
 * Adds a server-side time limit to a read query, so a slow query is killed by
 * the database itself and not only abandoned by us.
 *
 * - MariaDB: `SET STATEMENT max_statement_time=<s> FOR <query>`
 * - MySQL:   `SELECT /*+ MAX_EXECUTION_TIME(<ms>) *\/ ...` (only for queries starting with SELECT)
 */
export const withStatementTimeout = (sql: string, server: ServerInfo, timeout: Duration.Duration): string => {
  const millis = Math.max(1, Math.round(Duration.toMillis(timeout)));
  const trimmed = sql.trimStart();
  if (server.flavor === "mariadb") {
    return `SET STATEMENT max_statement_time=${(millis / 1000).toFixed(3)} FOR ${trimmed}`;
  }
  const match = /^select\b/i.exec(trimmed);
  return match ? `SELECT /*+ MAX_EXECUTION_TIME(${millis}) */${trimmed.slice(match[0].length)}` : trimmed;
};

/** Cheap first check that a statement only reads. The full SQL parser guard comes with jalankanQueryBaca (M4). */
export const looksReadOnly = (sql: string): boolean => /^\s*(select|with)\b/i.test(sql) && !sql.includes(";");

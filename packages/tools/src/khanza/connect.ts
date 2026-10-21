import { MysqlClient } from "@effect/sql-mysql2";
import { Effect, Layer } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import type { KhanzaConnectionOptions } from "../config.ts";

/**
 * Opens a connection pool to Khanza for one database user.
 *
 * Dates and times come back as strings ("2026-10-21", "08:00:00"), exactly as
 * stored. This avoids time-zone shifts and keeps Khanza's zero dates
 * ("0000-00-00") readable instead of turning them into invalid Date objects.
 */
export const connectKhanza = (options: KhanzaConnectionOptions, maxConnections: number) =>
  MysqlClient.make({
    host: options.host,
    port: options.port,
    database: options.database,
    username: options.username,
    password: options.password,
    maxConnections,
    poolConfig: {
      dateStrings: true,
      decimalNumbers: true,
      supportBigNumbers: true,
      connectTimeout: 10_000,
    },
  }).pipe(Effect.provide(Layer.fresh(Reactivity.layer)));

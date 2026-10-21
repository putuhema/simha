import { NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, FileSystem, Layer } from "effect";
import type { Config, PlatformError } from "effect";
import type { SqlClient, SqlError } from "effect/sql";
import { KhanzaReadLive } from "./khanza-read-layer.ts";

const fail = (message: string) =>
  Console.error(message).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    ),
  );

/** Underlying driver message, e.g. "Access denied for user ..." or "connect ECONNREFUSED". */
const driverMessage = (e: { readonly reason: { readonly cause?: unknown } }): string => {
  const cause = e.reason.cause;
  return cause instanceof Error ? cause.message : String(cause ?? "");
};

/**
 * Runs a script that reads Khanza with the read user, printing short messages
 * for config and connection errors instead of stack traces.
 */
export const runKhanzaScript = <A>(
  program: Effect.Effect<
    A,
    Config.ConfigError | SqlError.SqlError | PlatformError.PlatformError,
    SqlClient.SqlClient | FileSystem.FileSystem
  >,
): void =>
  program.pipe(
    Effect.provide(Layer.mergeAll(KhanzaReadLive, NodeFileSystem.layer)),
    Effect.catchTags({
      ConfigError: (e) =>
        fail(`Config error: ${e.message}\nCopy .env.example to .env and fill in the KHANZA_DB_* values.`),
      SqlError: (e) =>
        fail(
          `Database error (${e.reason._tag}): ${driverMessage(e) || e.message}\n` +
            "Check KHANZA_DB_HOST/PORT/NAME and the read user's credentials in .env.",
        ),
      PlatformError: (e) => fail(`File error: ${e.message}`),
    }),
    NodeRuntime.runMain,
  );

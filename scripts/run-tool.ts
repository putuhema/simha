/**
 * Runs one read tool (or lihatSkema / jalankanQueryBaca) against the Khanza database in .env and prints the JSON
 * result, for trying tools before the server exists. The call and its queries
 * are written to the audit log (AUDIT_DB_PATH, default data/audit.sqlite).
 *
 * Usage (from the repo root):
 *   pnpm tool                                   # list tools
 *   pnpm tool cariPasien '{"nama":"budi"}'
 *   pnpm tool riwayatKamar '{"noRawat":"2026/01/15/000123"}'
 *   pnpm tool lihatSkema '{"kataKunci":"obat"}'
 *   pnpm tool jalankanQueryBaca '{"sql":"SELECT COUNT(*) AS n FROM reg_periksa WHERE tgl_registrasi = CURDATE()","alasan":"tes"}'
 */
import { NodeRuntime } from "@effect/platform-node";
import {
  AuditLogLive,
  jalankanQueryBaca,
  KhanzaReadLive,
  lihatSkema,
  readTools,
  ResultStoreLive,
  runTool,
  SchemaDocsLive,
  ToolInputError,
} from "@simrs/tools";
import type { KhanzaRead, ResultStore, SchemaDocs, Tool } from "@simrs/tools";
import { Console, Effect, Layer } from "effect";

type AnyReadTool = Tool<unknown, unknown, KhanzaRead | ResultStore | SchemaDocs>;
const tools = [...readTools, lihatSkema, jalankanQueryBaca] as unknown as ReadonlyArray<AnyReadTool>;

const [name, json = "{}"] = process.argv.slice(2);

const fail = (message: string) =>
  Console.error(message).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    ),
  );

const listTools = Effect.gen(function* () {
  if (name !== undefined) yield* fail(`Unknown tool "${name}". Available tools:\n`);
  for (const t of tools) yield* Console.log(`${t.name.padEnd(16)} ${t.description}\n`);
});

const runOne = (tool: AnyReadTool) =>
  Effect.gen(function* () {
    const input: unknown = yield* Effect.try({
      try: () => JSON.parse(json),
      catch: () => new ToolInputError({ tool: tool.name, message: `Input is not valid JSON: ${json}` }),
    });
    const result = yield* runTool(tool, input, { sessionId: "cli" });
    yield* Console.log(JSON.stringify(result, null, 2));
  }).pipe(
    Effect.provide(
      Layer.mergeAll(KhanzaReadLive, ResultStoreLive, SchemaDocsLive).pipe(Layer.provideMerge(AuditLogLive)),
    ),
    Effect.catchTags({
      ConfigError: (e) => fail(`Config error: ${e.message}\nCopy .env.example to .env and fill it in.`),
      KhanzaSetupError: (e) => fail(e.message),
      KhanzaQueryError: (e) => fail(`Query failed (${e.kind}): ${e.message}`),
      ToolInputError: (e) => fail(`Invalid input for ${e.tool}: ${e.message}`),
      ToolError: (e) => fail(`${e.tool}: ${e.message}`),
      SqlError: (e) => {
        const cause = e.reason.cause;
        const detail = cause instanceof Error ? cause.message : e.message;
        const hint =
          e.reason._tag === "AuthorizationError"
            ? "\nThe user exists but lacks permission. Check SHOW GRANTS for it (see README: GRANT SELECT ON <db>.*)."
            : e.reason._tag === "AuthenticationError"
              ? "\nCheck KHANZA_DB_READ_USER / KHANZA_DB_READ_PASS in .env."
              : "";
        return fail(`Database error (${e.reason._tag}): ${detail}${hint}`);
      },
      MigrationError: (e) => fail(`Audit DB migration failed: ${e.message}`),
    }),
  );

const tool = tools.find((t) => t.name === name);
NodeRuntime.runMain(tool === undefined ? listTools : runOne(tool));

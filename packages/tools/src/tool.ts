/**
 * Provider-neutral tool definition and runner.
 *
 * A tool is a name, a description, a `kind`, an Effect Schema for its
 * parameters and output, and a handler. `runTool` validates the input, runs
 * the handler, and records the call in the audit log. The registry and the
 * conversion to JSON Schema for AI providers are in registry.ts.
 */
import type { Permissions } from "@simha/shared";
import { ALL_PERMISSIONS } from "@simha/shared";
import { Effect, Schema } from "effect";
import { AuditLog } from "./audit/AuditLog.ts";
import { ToolError, ToolInputError, ToolPermissionError } from "./errors.ts";
import { CurrentActor, CurrentPermissions, CurrentSession, CurrentToolCall } from "./khanza/current-tool-call.ts";
import type { KhanzaQueryError } from "./errors.ts";

export type ToolKind = "read" | "diagnose" | "propose" | "render";

export type ToolFailure = ToolError | ToolPermissionError | KhanzaQueryError;

export interface Tool<P, O, R> {
  /** Name the AI model calls, e.g. "riwayatKamar". */
  readonly name: string;
  readonly kind: ToolKind;
  /** What the tool does and when to use it, written for the AI model. */
  readonly description: string;
  readonly parameters: Schema.Codec<P, unknown>;
  readonly output: Schema.Codec<O, unknown>;
  readonly handler: (params: P) => Effect.Effect<O, ToolFailure, R>;
  /**
   * Whether a SIMRS account may use the tool at all. The agent offers only the
   * tools it passes; the handler still checks when it needs more context (e.g.
   * a CPPT document's outpatient/inpatient right depends on the visit).
   */
  readonly requires?: (permissions: Permissions) => boolean;
  /**
   * What the AI model sees of the output, when it should see less than the
   * UI and the audit log (e.g. the first 50 of 500 rows). Default: all of it.
   */
  readonly forModel?: (output: O) => unknown;
}

export const defineTool = <P, O, R>(tool: Tool<P, O, R>): Tool<P, O, R> => tool;

/** True when `permissions` satisfy the tool's `requires` (no predicate means allowed). */
export const toolAllowed = (
  tool: { readonly requires?: ((permissions: Permissions) => boolean) | undefined },
  permissions: Permissions,
): boolean => tool.requires === undefined || tool.requires(permissions);

/** Fails with a 403-shaped tool error when the SIMRS account lacks a right. */
export const requirePermission = (tool: string, granted: boolean, message: string) =>
  granted ? Effect.void : Effect.fail(new ToolPermissionError({ tool, message }));

export interface RunToolOptions {
  /** Ticket or chat session the call belongs to, for the audit log. */
  readonly sessionId?: string | null;
  /** Username of the person asking (shown on generated documents). */
  readonly actor?: string | null;
  /** The logged-in SIMRS account's snapshot; defaults to everything for the CLI and scripts. */
  readonly permissions?: Permissions;
}

/** Schema error text, shortened to what an AI model needs to fix its input. */
const describeInputError = (error: Schema.SchemaError): string => error.message;

/**
 * Validates `input` against the tool's Schema, runs it, and records the call
 * (input, output or error, duration) in the audit log. Queries the handler
 * runs are linked to this call through `CurrentToolCall`.
 */
export const runTool = <P, O, R>(tool: Tool<P, O, R>, input: unknown, options: RunToolOptions = {}) =>
  Effect.gen(function* () {
    const audit = yield* AuditLog;
    const id = crypto.randomUUID();
    const started = performance.now();
    yield* audit.toolCallStarted({ id, sessionId: options.sessionId ?? null, tool: tool.name, kind: tool.kind, input });

    const result = yield* Schema.decodeUnknownEffect(tool.parameters)(input).pipe(
      Effect.mapError((e) => new ToolInputError({ tool: tool.name, message: describeInputError(e) })),
      Effect.flatMap(tool.handler),
      Effect.provideService(CurrentToolCall, id),
      Effect.provideService(CurrentSession, options.sessionId ?? null),
      Effect.provideService(CurrentActor, options.actor ?? null),
      Effect.provideService(CurrentPermissions, options.permissions ?? ALL_PERMISSIONS),
      Effect.exit,
    );

    const durationMs = performance.now() - started;
    if (result._tag === "Success") {
      yield* audit.toolCallFinished({ id, status: "ok", output: result.value, durationMs });
    } else {
      const failure = result.cause.reasons.find((r) => r._tag === "Fail");
      const message = failure?._tag === "Fail" && failure.error instanceof Error ? failure.error.message : String(result.cause);
      yield* audit.toolCallFinished({ id, status: "error", error: message, durationMs });
    }
    return yield* result;
  });

/** Decodes database rows into a tool's row Schema, failing with a readable ToolError. */
export const decodeRows =
  <A>(tool: string, schema: Schema.Codec<A, unknown>) =>
  (rows: ReadonlyArray<unknown>): Effect.Effect<ReadonlyArray<A>, ToolError> =>
    Schema.decodeUnknownEffect(Schema.Array(schema))(rows).pipe(
      Effect.mapError(
        (e) =>
          new ToolError({
            tool,
            message: `Data dari database tidak sesuai bentuk yang diharapkan (skema Khanza berubah?): ${e.message}`,
          }),
      ),
    );

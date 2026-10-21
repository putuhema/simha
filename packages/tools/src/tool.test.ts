import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { AuditLogMemory } from "./audit/AuditLog.ts";
import { ToolError } from "./errors.ts";
import { defineTool, runTool } from "./tool.ts";

const echo = defineTool({
  name: "echo",
  kind: "read",
  description: "Returns its input; fails when asked to.",
  parameters: Schema.Struct({ text: Schema.String, fail: Schema.optionalKey(Schema.Boolean) }),
  output: Schema.Struct({ text: Schema.String }),
  handler: (params) =>
    params.fail ? Effect.fail(new ToolError({ tool: "echo", message: "gagal" })) : Effect.succeed({ text: params.text }),
});

interface ToolCallRow {
  readonly tool: string;
  readonly status: string;
  readonly input_json: string;
  readonly output_json: string | null;
  readonly error: string | null;
  readonly session_id: string | null;
}

const auditRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<ToolCallRow>`SELECT tool, status, input_json, output_json, error, session_id FROM tool_calls`;
});

describe("runTool", () => {
  it.effect("records a successful call with input and output", () =>
    Effect.gen(function* () {
      const result = yield* runTool(echo, { text: "halo" }, { sessionId: "ticket-1" });
      expect(result).toEqual({ text: "halo" });
      const [row] = yield* auditRows;
      expect(row).toMatchObject({ tool: "echo", status: "ok", session_id: "ticket-1" });
      expect(JSON.parse(row?.input_json ?? "")).toEqual({ text: "halo" });
      expect(JSON.parse(row?.output_json ?? "")).toEqual({ text: "halo" });
    }).pipe(Effect.provide(AuditLogMemory)),
  );

  it.effect("rejects invalid input with a message the model can act on, and logs it", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(runTool(echo, { text: 42 }));
      expect(error._tag).toBe("ToolInputError");
      expect(error.message).toMatch(/text/);
      const [row] = yield* auditRows;
      expect(row).toMatchObject({ status: "error" });
      expect(row?.error).toMatch(/text/);
    }).pipe(Effect.provide(AuditLogMemory)),
  );

  it.effect("logs handler failures", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(runTool(echo, { text: "x", fail: true }));
      expect(error).toMatchObject({ _tag: "ToolError", message: "gagal" });
      const [row] = yield* auditRows;
      expect(row).toMatchObject({ status: "error", error: "gagal" });
    }).pipe(Effect.provide(AuditLogMemory)),
  );
});

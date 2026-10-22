/**
 * Test app: the real routes, agent loop, store and tools, with a scripted
 * fake AI provider, the throwaway Khanza test DB and an in-memory audit DB.
 */
import { NodeFileSystem } from "@effect/platform-node";
import { LlmClient, makeFakeClient, type FakeTurn, type LlmInfo } from "@simrs/llm";
import type { AgentEvent } from "@simrs/shared";
import { AuditLogMemory, FixStoreLive, khanzaReadLayer, khanzaWriteLayer, ResultStoreLive, schemaDocsLayer } from "@simrs/tools";
import { connectionAs, testDb } from "@simrs/tools/testing";
import { Duration, Effect, Layer, ManagedRuntime } from "effect";
import { SqlClient } from "effect/sql";
import { HttpRouter } from "effect/http";
import { AgentLive } from "../src/agent/Agent.ts";
import { FixExecutorLive } from "../src/fixes/FixExecutor.ts";
import { systemPromptLayer } from "../src/agent/prompt.ts";
import { Routes } from "../src/http/routes.ts";
import { StoreLive } from "../src/store.ts";

export { testDb };

/** Small docs for lihatSkema in tests (the real docs/schema.md describes the hospital DB). */
const TEST_DOCS = {
  schema: [
    "## `poliklinik`",
    "",
    "Purpose: Clinics",
    "",
    "| # | Column | Type | Null | Key | Default | Extra | Comment |",
    "|---|---|---|---|---|---|---|---|",
    "| 1 | `kd_poli` | char(5) | no | PRI |  |  |  |",
    "| 2 | `nm_poli` | varchar(50) | yes |  | NULL |  |  |",
    "",
  ].join("\n"),
  notes: "# Notes\n\n- `kd_poli` for poli gigi is `GIG`.\n- TODO: more\n",
};

export const makeTestApp = (script: ReadonlyArray<FakeTurn>, info?: Partial<LlmInfo>, docs = TEST_DOCS) => {
  const db = testDb;
  if (db === null) throw new Error("no test DB");
  const fake = makeFakeClient(script, info);
  const app = Layer.mergeAll(AgentLive, FixExecutorLive).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        StoreLive,
        FixStoreLive,
        ResultStoreLive,
        schemaDocsLayer(docs),
        khanzaWriteLayer(connectionAs(db, db.writeUser, db.writePass)),
        khanzaReadLayer({ connection: connectionAs(db, db.readUser, db.readPass), timeout: Duration.seconds(5) }),
        Layer.succeed(LlmClient, fake),
        systemPromptLayer("Test system prompt."),
      ),
    ),
    Layer.provideMerge(AuditLogMemory),
    Layer.provide(NodeFileSystem.layer),
  );
  // One memo map, so the HTTP handler and `audit` below share the same in-memory audit DB.
  const memoMap = Layer.makeMemoMapUnsafe();
  const runtime = ManagedRuntime.make(app, { memoMap });
  const web = HttpRouter.toWebHandler(Routes.pipe(Layer.provideMerge(app)), { disableLogger: true, memoMap });
  const { handler } = web;
  const dispose = async () => {
    await web.dispose();
    await runtime.dispose();
  };
  /** Runs a query on the audit DB. */
  const audit = <A extends object>(query: string) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.unsafe<A>(query);
      }),
    );
  const call = (method: string, path: string, body?: unknown) =>
    handler(
      new Request(`http://test${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      }),
    );
  return { fake, call, audit, runtime, dispose };
};

/** Reads a whole SSE response into events. */
export const readEvents = async (response: Response): Promise<Array<AgentEvent>> => {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => JSON.parse(block.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "null") as AgentEvent);
};

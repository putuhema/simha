/**
 * Test app: the real routes, agent loop, store and tools, with a scripted
 * fake AI provider, the throwaway Khanza test DB and an in-memory audit DB.
 */
import { NodeFileSystem } from "@effect/platform-node";
import { makeFakeClient, type FakeTurn, type LlmInfo } from "@simrs/llm";
import type { AgentEvent } from "@simrs/shared";
import { AuditLogMemory, FixStoreLive, khanzaReadLayer, khanzaWriteLayer, pacsLayer, ResultStoreLive, schemaDocsLayer, type Pacs } from "@simrs/tools";
import { connectionAs, testDb } from "@simrs/tools/testing";
import { Duration, Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { HttpRouter } from "effect/http";
import { AgentLive } from "../src/agent/Agent.ts";
import { AuthLive } from "../src/auth/Auth.ts";
import { HttpSettings } from "../src/config.ts";
import { FixExecutorLive } from "../src/fixes/FixExecutor.ts";
import { systemPromptLayer } from "../src/agent/prompt.ts";
import { Routes } from "../src/http/routes.ts";
import { llmSettingsLayer } from "../src/llm/LlmSettings.ts";
import { StoreLive } from "../src/store.ts";
import { ViewsLive } from "../src/views.ts";

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

/** The first user (admin), who makes every request unless a test says otherwise. */
/** The session cookie from a login or setup response. */
const cookieOf = (response: Response) => {
  const header = response.headers.get("set-cookie") ?? "";
  const value = /simrs_session=([^;]+)/.exec(header)?.[1];
  if (!value) throw new Error(`no session cookie (${response.status})`);
  return `simrs_session=${value}`;
};

const DEFAULT_USER = "it-budi";
const PASSWORD = "rahasia-uji-123";

export interface TestAppOptions {
  /** Directory served as the web UI. */
  readonly webDir?: string;
  /** The PACS (e.g. the fake Orthanc). Default: not configured. */
  readonly pacs?: Layer.Layer<Pacs>;
}

export const makeTestApp = (
  script: ReadonlyArray<FakeTurn>,
  info?: Partial<LlmInfo>,
  docs = TEST_DOCS,
  options: TestAppOptions = {},
) => {
  const db = testDb;
  if (db === null) throw new Error("no test DB");
  const fake = makeFakeClient(script, info);
  const llm = llmSettingsLayer({
    env: { provider: "fake", model: "fake-model", baseUrl: undefined, apiKey: undefined, maskPii: fake.info.maskPii },
    initialClient: fake,
  });
  const app = Layer.mergeAll(AgentLive, FixExecutorLive, ViewsLive).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        StoreLive,
        FixStoreLive,
        ResultStoreLive,
        schemaDocsLayer(docs),
        khanzaWriteLayer(connectionAs(db, db.writeUser, db.writePass)),
        khanzaReadLayer({ connection: connectionAs(db, db.readUser, db.readPass), timeout: Duration.seconds(5) }),
        llm,
        AuthLive,
        Layer.succeed(HttpSettings, { webDir: options.webDir ?? "/nonexistent", secureCookie: false }),
        systemPromptLayer("Test system prompt."),
        options.pacs ?? pacsLayer({ url: "", user: "", pass: Redacted.make("") }),
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
  /** A request as-is, without a session unless `cookie` is given. */
  const raw = (method: string, path: string, body?: unknown, cookie?: string) =>
    handler(
      new Request(`http://test${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  /** Session cookie per username; users are created on first use (the first one is the admin). */
  const sessions = new Map<string, string>();
  const sessionFor = async (username: string, role: "admin" | "staff" = "staff"): Promise<string> => {
    const known = sessions.get(username);
    if (known) return known;
    if (sessions.size === 0 && username !== DEFAULT_USER) await sessionFor(DEFAULT_USER);
    if (sessions.size === 0) {
      const setup = await raw("POST", "/api/auth/setup", { username, displayName: username, password: PASSWORD });
      sessions.set(username, cookieOf(setup));
      return sessions.get(username) as string;
    }
    const admin = sessions.get(DEFAULT_USER) as string;
    const created = await raw("POST", "/api/users", { username, displayName: username, password: PASSWORD, role }, admin);
    if (created.status !== 201) throw new Error(`could not create ${username}: ${await created.text()}`);
    const login = await raw("POST", "/api/auth/login", { username, password: PASSWORD });
    sessions.set(username, cookieOf(login));
    return sessions.get(username) as string;
  };

  /** A request as `username` (logged in, created if needed). */
  const callAs = async (username: string, method: string, path: string, body?: unknown) =>
    raw(method, path.startsWith("/api") ? path : `/api${path}`, body, await sessionFor(username));
  /** A request as the default user (admin). Paths without /api get it added. */
  const call = (method: string, path: string, body?: unknown) => callAs(DEFAULT_USER, method, path, body);

  return { fake, call, callAs, raw, sessionFor, password: PASSWORD, audit, runtime, dispose };
};

/** Reads a whole SSE response into events. */
export const readEvents = async (response: Response): Promise<Array<AgentEvent>> => {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => JSON.parse(block.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "null") as AgentEvent);
};

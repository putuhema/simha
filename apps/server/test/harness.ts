/**
 * Test app: the real routes, agent loop, store and tools, with a scripted
 * fake AI provider, the throwaway Khanza test DB and an in-memory audit DB.
 */
import { NodeFileSystem } from "@effect/platform-node";
import { makeFakeClient, type FakeTurn, type LlmInfo } from "@simha/llm";
import type { AgentEvent } from "@simha/shared";
import { appDocsLayer, AuditLogMemory, Berkas, FixStoreLive, khanzaReadLayer, khanzaWriteLayer, makeBerkas, pacsLayer, KnowledgeStoreLive, ResultStoreLive, schemaDocsLayer, type Pacs } from "@simha/tools";
import { connectionAs, testDb } from "@simha/tools/testing";
import { Duration, Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { HttpRouter } from "effect/http";
import mysql from "mysql2/promise";
import { AgentLive } from "../src/agent/Agent.ts";
import { AuthLive } from "../src/auth/Auth.ts";
import { KhanzaAccountsLive } from "../src/auth/KhanzaAccounts.ts";
import { HttpSettings } from "../src/config.ts";
import { FixExecutorLive } from "../src/fixes/FixExecutor.ts";
import { systemPromptLayer } from "../src/agent/prompt.ts";
import { Routes } from "../src/http/routes.ts";
import { llmSettingsLayer } from "../src/llm/LlmSettings.ts";
import { StoreLive } from "../src/store.ts";
import { UsageLive } from "../src/usage.ts";
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

/** The default SIMRS account (an Admin Utama), used unless a test says otherwise. */
const DEFAULT_USER = "it-budi";
const PASSWORD = "rahasia-uji-123";

/** The Khanza rights the test auth fixture has columns for. */
const TEST_RIGHTS = [
  "pasien",
  "registrasi",
  "tindakan_ralan",
  "tindakan_ranap",
  "kamar_inap",
  "periksa_radiologi",
  "berkas_digital_perawatan",
  "data_resume_pasien",
  "bpjs_surat_kontrol",
  "skdp_bpjs",
] as const;
export type TestRight = (typeof TEST_RIGHTS)[number];
const ALL_TEST_RIGHTS: ReadonlyArray<TestRight> = TEST_RIGHTS;

/**
 * Creates (or updates) the matching Khanza `admin`/`user` row in the throwaway
 * test DB, so server tests can log in exactly like a real SIMRS user.
 */
const ensureKhanzaAccount = async (
  username: string,
  admin: boolean,
  rights: ReadonlyArray<TestRight>,
): Promise<void> => {
  const db = testDb;
  if (db === null) throw new Error("no test DB");
  const connection = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.adminUser,
    password: db.adminPass,
    database: db.database,
  });
  try {
    if (admin) {
      // One atomic statement: test files run in parallel and a delete/insert
      // gap would let a concurrent login miss the admin row and become staff.
      await connection.execute(
        `INSERT INTO admin (usere, passworde) VALUES (AES_ENCRYPT(?, 'nur'), AES_ENCRYPT(?, 'windi'))
         ON DUPLICATE KEY UPDATE passworde = VALUES(passworde)`,
        [username, PASSWORD],
      );
    } else {
      await connection.execute("DELETE FROM admin WHERE usere = AES_ENCRYPT(?, 'nur')", [username]);
    }
    const columns = TEST_RIGHTS.map((right) => `\`${right}\``).join(", ");
    const placeholders = TEST_RIGHTS.map(() => "?").join(", ");
    const updates = TEST_RIGHTS.map((right) => `\`${right}\` = VALUES(\`${right}\`)`).join(", ");
    await connection.execute(
      `INSERT INTO user (id_user, password, ${columns})
       VALUES (AES_ENCRYPT(?, 'nur'), AES_ENCRYPT(?, 'windi'), ${placeholders})
       ON DUPLICATE KEY UPDATE password = VALUES(password), ${updates}`,
      [username, PASSWORD, ...TEST_RIGHTS.map((right) => (rights.includes(right) ? "true" : "false"))],
    );
  } finally {
    await connection.end();
  }
};

/** Removes the Khanza account, as Khanza does when a user is deleted. */
const removeKhanzaAccount = async (username: string): Promise<void> => {
  const db = testDb;
  if (db === null) throw new Error("no test DB");
  const connection = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.adminUser,
    password: db.adminPass,
    database: db.database,
  });
  try {
    await connection.execute("DELETE FROM admin WHERE usere = AES_ENCRYPT(?, 'nur')", [username]);
    await connection.execute("DELETE FROM user WHERE id_user = AES_ENCRYPT(?, 'nur')", [username]);
  } finally {
    await connection.end();
  }
};

/** Changes a staff account's rights; the current session keeps its snapshot until refresh. */
const setKhanzaRights = (username: string, rights: ReadonlyArray<TestRight>) =>
  ensureKhanzaAccount(username, false, rights);

/** The session cookie from a login response. */
const cookieOf = (response: Response) => {
  const header = response.headers.get("set-cookie") ?? "";
  const value = /simha_session=([^;]+)/.exec(header)?.[1];
  if (!value) throw new Error(`no session cookie (${response.status})`);
  return `simha_session=${value}`;
};

export interface TestAppOptions {
  /** Directory served as the web UI. */
  readonly webDir?: string;
  /** The PACS (e.g. the fake Orthanc). Default: not configured. */
  readonly pacs?: Layer.Layer<Pacs>;
  /** Digital-file backend. Default: no folder, so files are listed but cannot be opened. */
  readonly berkas?: Layer.Layer<Berkas>;
  /** app map JSON (docs/khanza-app/index.json); default: empty. */
  readonly appDocs?: string;
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
  const read = khanzaReadLayer({ connection: connectionAs(db, db.readUser, db.readPass), timeout: Duration.seconds(5) });
  const auth = AuthLive.pipe(Layer.provideMerge(KhanzaAccountsLive.pipe(Layer.provideMerge(read))));
  const app = Layer.mergeAll(AgentLive, FixExecutorLive, ViewsLive, UsageLive).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        StoreLive,
        FixStoreLive,
        KnowledgeStoreLive,
        ResultStoreLive,
        schemaDocsLayer(docs),
        appDocsLayer(options.appDocs ?? JSON.stringify({ source: { commit: "test" }, groups: [], forms: {}, rights: {} })),
        khanzaWriteLayer(connectionAs(db, db.writeUser, db.writePass)),
        auth,
        llm,
        Layer.succeed(HttpSettings, { webDir: options.webDir ?? "/nonexistent", secureCookie: false }),
        systemPromptLayer("Test system prompt."),
        options.pacs ?? pacsLayer({ url: "", user: "", pass: Redacted.make("") }),
        options.berkas ?? Layer.succeed(Berkas, makeBerkas({ dir: "" })),
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

  /** Session cookie per username; SIMRS accounts are created on first use. */
  const sessions = new Map<string, string>();
  const sessionFor = async (
    username: string,
    role: "admin" | "staff" = "staff",
    rights: ReadonlyArray<TestRight> = ALL_TEST_RIGHTS,
  ): Promise<string> => {
    const known = sessions.get(username);
    if (known) return known;
    const admin = role === "admin" || username === DEFAULT_USER;
    await ensureKhanzaAccount(username, admin, rights);
    const login = await raw("POST", "/api/auth/login", { username, password: PASSWORD });
    if (login.status !== 200) throw new Error(`could not log in ${username}: ${await login.text()}`);
    sessions.set(username, cookieOf(login));
    return sessions.get(username) as string;
  };

  /** A request as `username` (logged in, created if needed). */
  const callAs = async (username: string, method: string, path: string, body?: unknown) =>
    raw(method, path.startsWith("/api") ? path : `/api${path}`, body, await sessionFor(username));
  /** A request as the default user (admin). Paths without /api get it added. */
  const call = (method: string, path: string, body?: unknown) => callAs(DEFAULT_USER, method, path, body);
  /** Deletes the SIMRS account; the next login cannot succeed. */
  const removeAccount = async (username: string) => {
    await removeKhanzaAccount(username);
    sessions.delete(username);
  };

  return {
    fake,
    call,
    callAs,
    raw,
    sessionFor,
    setRights: setKhanzaRights,
    removeAccount,
    password: PASSWORD,
    audit,
    runtime,
    dispose,
  };
};

/** Reads a whole SSE response into events. */
export const readEvents = async (response: Response): Promise<Array<AgentEvent>> => {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => JSON.parse(block.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "null") as AgentEvent);
};

/**
 * AI usage & cost: the admin report, its price book and the CSV export.
 *
 * Runs are inserted straight into the in-memory audit DB with known tokens,
 * timestamps and statuses, so the totals can be checked exactly.
 */
import { costUsdOf, priceFor, type UsageReport } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { daysBetween } from "../src/usage.ts";
import { makeTestApp, testDb } from "./harness.ts";

const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** A local time `daysAgo` days ago (so `date(..., 'localtime')` groups it as expected). */
const at = (daysAgo: number, hour: number, seconds = 0) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 0, seconds).toISOString();
};

const dayAgo = (days: number) => {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
};

const sqlText = (value: string | null) => (value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`);

interface Run {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly user: string | null;
  readonly status: "ok" | "error" | "interrupted";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly steps: number;
  readonly input: number | null;
  readonly cached: number | null;
  readonly cacheWrite: number | null;
  readonly output: number | null;
  readonly question: string;
  readonly error: string | null;
}

const insertRun = (run: Run) =>
  `INSERT INTO agent_runs (id, conversation_id, ticket_id, kind, mode, question, asked_by, provider, model, mask_pii,
    status, steps, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, error, started_at, finished_at)
   VALUES (${sqlText(run.id)}, 'conversation-1', NULL, 'ask', 'tanya', ${sqlText(run.question)}, ${sqlText(run.user)},
    ${sqlText(run.provider)}, ${sqlText(run.model)}, 0, ${sqlText(run.status)}, ${run.steps},
    ${run.input ?? "NULL"}, ${run.cached ?? "NULL"}, ${run.cacheWrite ?? "NULL"}, ${run.output ?? "NULL"},
    ${sqlText(run.error)}, ${sqlText(run.startedAt)}, ${sqlText(run.finishedAt)})`;

const RUNS: ReadonlyArray<Run> = [
  {
    id: "run-a",
    provider: "acme",
    model: "acme-pro",
    user: "it-budi",
    status: "ok",
    startedAt: at(2, 10),
    finishedAt: at(2, 10, 10),
    steps: 3,
    input: 1_000,
    cached: 600,
    cacheWrite: 100,
    output: 200,
    question: "Kamar, Mawar?",
    error: null,
  },
  {
    id: "run-b",
    provider: "acme",
    model: "acme-pro",
    user: "ns-ayu",
    status: "error",
    startedAt: at(1, 10),
    finishedAt: at(1, 10, 5),
    steps: 1,
    input: 500,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    question: "=SUM(1,2)",
    error: "acme 500 error: server sedang sibuk",
  },
  {
    id: "run-c",
    provider: "other",
    model: "local-1",
    user: "it-budi",
    status: "interrupted",
    startedAt: at(0, 10),
    finishedAt: at(0, 10, 30),
    steps: 1,
    input: null,
    cached: null,
    cacheWrite: null,
    output: null,
    question: "Pertanyaan yang dihentikan",
    error: "Koneksi ditutup sebelum selesai.",
  },
  // Outside the 3-day window: must not be counted.
  {
    id: "run-old",
    provider: "acme",
    model: "acme-pro",
    user: "it-budi",
    status: "ok",
    startedAt: at(9, 10),
    finishedAt: at(9, 10, 1),
    steps: 1,
    input: 9_999,
    cached: 0,
    cacheWrite: 0,
    output: 9_999,
    question: "Pertanyaan lama",
    error: null,
  },
];

const seed = async () => {
  const app = makeTestApp([]);
  await app.audit(`INSERT INTO conversations (id, kind, ticket_id, created_at) VALUES ('conversation-1', 'ask', NULL, '${at(10, 9)}')`);
  for (const run of RUNS) await app.audit(insertRun(run));
  return app;
};

describe("price estimation", () => {
  it("matches the built-in prices by model family, with the specific one first", () => {
    expect(priceFor("vikey", "deepseek/deepseek-v4.1-flash")).toMatchObject({ input: 0.27, cachedInput: 0.07 });
    expect(priceFor("anthropic", "claude-opus-4-1")).toMatchObject({ input: 15, output: 75, cacheWrite: 18.75 });
    expect(priceFor("openai", "gpt-4o-mini")).toMatchObject({ input: 0.15 });
    expect(priceFor("openai", "gpt-4o")).toMatchObject({ input: 2.5 });
    expect(priceFor("acme", "acme-pro")).toBeNull();
  });

  it("prefers a saved price, by provider+model first and then the same model elsewhere", () => {
    const saved = [
      { provider: "gateway", model: "deepseek-chat", input: 1, output: 2, cachedInput: 0.5, cacheWrite: 0 },
      { provider: "acme", model: "acme-pro", input: 3, output: 4, cachedInput: 1, cacheWrite: 0 },
    ];
    expect(priceFor("acme", "acme-pro", saved)).toMatchObject({ input: 3 });
    expect(priceFor("elsewhere", "acme-pro", saved)).toMatchObject({ input: 3 });
    expect(priceFor("vikey", "deepseek-chat", saved)).toMatchObject({ input: 1 });
  });

  it("charges cached and cache-write input at their own prices", () => {
    const price = { provider: "acme", model: "acme-pro", input: 1, output: 2, cachedInput: 0.5, cacheWrite: 1.5 };
    expect(costUsdOf(price, { inputTokens: 1_000, cachedInputTokens: 600, cacheWriteTokens: 100, outputTokens: 200 })).toBeCloseTo(
      0.00115,
      10,
    );
    // `inputTokens` includes the cached parts and must not go below zero.
    expect(costUsdOf(price, { inputTokens: 10, cachedInputTokens: 500, cacheWriteTokens: 0, outputTokens: 0 })).toBeCloseTo(
      0.00025,
      10,
    );
    expect(costUsdOf(null, { inputTokens: 1_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe("usage date range", () => {
  it("lists every calendar day, including quiet ones", () => {
    expect(daysBetween("2026-10-01", "2026-10-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(daysBetween("2026-10-03", "2026-10-01")).toEqual([]);
  });
});

describe.skipIf(testDb === null)("usage report", () => {
  it("aggregates runs, tokens, cache hit rate, cost, users, slowest questions and failures", async () => {
    const app = await seed();
    try {
      await app.sessionFor("it-budi", "admin");
      expect(
        (
          await app.call("PUT", "/usage/prices", {
            usdIdr: 16_000,
            models: [{ provider: "acme", model: "acme-pro", input: 1, output: 2, cachedInput: 0.5, cacheWrite: 1.5 }],
          })
        ).status,
      ).toBe(200);

      const from = dayAgo(2);
      const to = dayAgo(0);
      const response = await app.call("GET", `/usage?from=${from}&to=${to}`);
      expect(response.status).toBe(200);
      const report = (await response.json()) as UsageReport;

      expect(report.from).toBe(from);
      expect(report.to).toBe(to);
      expect(report.days).toHaveLength(3);
      expect(report.totals).toMatchObject({
        runs: 3,
        ok: 1,
        failed: 2,
        steps: 5,
        inputTokens: 1_500,
        cachedInputTokens: 600,
        cacheWriteTokens: 100,
        outputTokens: 200,
        users: 2,
        unpricedRuns: 1,
        noTokenRuns: 1,
      });
      expect(report.totals.cacheHitRate).toBeCloseTo(0.4, 10);
      expect(report.totals.costUsd).toBeCloseTo(0.00165, 10);
      expect(report.totals.durationMs).toBe(45_000); // 10s + 5s + 30s

      expect(report.days.map((day) => day.runs)).toEqual([1, 1, 1]);
      expect(report.days.map((day) => day.failed)).toEqual([0, 1, 1]);
      expect(report.days[0]?.costUsd).toBeCloseTo(0.00115, 10);

      expect(report.models).toHaveLength(2);
      const acme = report.models.find((model) => model.model === "acme-pro");
      expect(acme).toMatchObject({ provider: "acme", runs: 2, failed: 1, steps: 4, inputTokens: 1_500, outputTokens: 200 });
      expect(acme?.cacheHitRate).toBeCloseTo(0.4, 10);
      expect(acme?.costUsd).toBeCloseTo(0.00165, 10);
      const local = report.models.find((model) => model.model === "local-1");
      expect(local).toMatchObject({ runs: 1, failed: 1, unpricedRuns: 1, noTokenRuns: 1, costUsd: 0 });

      const budi = report.users.find((user) => user.user === "it-budi");
      expect(budi).toMatchObject({ runs: 2, failed: 1, inputTokens: 1_000, outputTokens: 200, unpricedRuns: 1 });
      expect(budi?.costUsd).toBeCloseTo(0.00115, 10);
      expect(report.users.find((user) => user.user === "ns-ayu")).toMatchObject({ runs: 1, failed: 1 });

      // Slowest: the 30s interrupted run, then 10s, then 5s.
      expect(report.slowest.map((question) => question.id)).toEqual(["run-c", "run-a", "run-b"]);
      expect(report.slowest[0]).toMatchObject({ question: "Pertanyaan yang dihentikan", durationMs: 30_000, costUsd: null });
      expect(report.slowest[1]?.costUsd).toBeCloseTo(0.00115, 10);

      expect(report.failures).toEqual([
        expect.objectContaining({ provider: "other", model: "local-1", errors: 0, interrupted: 1, lastError: "Koneksi ditutup sebelum selesai." }),
        expect.objectContaining({ provider: "acme", model: "acme-pro", errors: 1, interrupted: 0, lastError: "acme 500 error: server sedang sibuk" }),
      ]);

      expect(report.prices.usdIdr).toBe(16_000);
      expect(report.prices.models).toEqual([{ provider: "acme", model: "acme-pro", input: 1, output: 2, cachedInput: 0.5, cacheWrite: 1.5 }]);

      // Saving another model's price keeps the first one (the dialog only sends
      // the models in the current report).
      await app.call("PUT", "/usage/prices", {
        usdIdr: 16_500,
        models: [{ provider: "other", model: "local-1", input: 0, output: 0, cachedInput: 0, cacheWrite: 0 }],
      });
      const [stored] = await app.audit<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'usage_prices'");
      const book = JSON.parse(stored?.value_json ?? "{}") as { usdIdr: number; models: Array<{ model: string }> };
      expect(book.usdIdr).toBe(16_500);
      expect(book.models.map((model) => model.model).toSorted()).toEqual(["acme-pro", "local-1"]);
    } finally {
      await app.dispose();
    }
  });

  it("is admin only and validates the date range", async () => {
    const app = await seed();
    try {
      await app.sessionFor("it-budi", "admin");
      expect((await app.raw("GET", "/api/usage")).status).toBe(401);
      expect((await app.callAs("ns-ayu", "GET", "/usage")).status).toBe(403);
      expect((await app.call("GET", "/usage?from=2026-10-10&to=2026-10-01")).status).toBe(400);
      expect((await app.call("GET", "/usage?from=2020-01-01&to=2026-10-01")).status).toBe(400);
      expect((await app.callAs("ns-ayu", "PUT", "/usage/prices", { usdIdr: 0, models: [] })).status).toBe(403);
    } finally {
      await app.dispose();
    }
  });

  it("exports one CSV row per run, safe for spreadsheets", async () => {
    const app = await seed();
    try {
      await app.sessionFor("it-budi", "admin");
      const from = dayAgo(2);
      const to = dayAgo(0);
      const response = await app.call("GET", `/usage/export?from=${from}&to=${to}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      expect(response.headers.get("content-disposition")).toContain("pemakaian-ai-");
      // Fetch strips a leading BOM when decoding text, so check the bytes.
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
      const csv = new TextDecoder().decode(bytes.slice(3));
      expect(csv.startsWith("mulai,selesai,pengguna")).toBe(true);

      const lines = csv.trim().split("\r\n");
      // Header + the three runs; the old run is outside the window.
      expect(lines).toHaveLength(4);
      expect(lines[1]).toContain("interrupted");
      expect(lines[1]).toContain("Pertanyaan yang dihentikan");
      // A question that starts with "=" must not run as a formula.
      expect(csv).toContain(`"'=SUM(1,2)"`);
      // Comma in a question stays inside one quoted cell.
      expect(csv).toContain(`"Kamar, Mawar?"`);
      expect(csv).not.toContain("9999");
    } finally {
      await app.dispose();
    }
  });
});

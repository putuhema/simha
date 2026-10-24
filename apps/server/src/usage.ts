/**
 * AI usage and cost: aggregates over agent_runs for the admin page.
 *
 * Every question already stores who asked it, the provider/model, the steps
 * and the tokens (input, cached input, cache write, output), plus when it
 * started and finished. This service turns those rows into runs and tokens
 * per day, cache hit rate, estimated cost, failures by provider, the slowest
 * questions and per-user usage. It reads only the audit DB; nothing here can
 * change Khanza.
 *
 * Costs are estimates at list prices (USD per 1M tokens). The price book lives
 * in the audit DB's `settings` table so an admin can match the provider's
 * actual invoice without a restart; built-in prices fill anything not set.
 */
import {
  cacheHitRateOf,
  costUsdOf,
  priceFor,
  toCsv,
  type ModelPrice,
  type PriceBook,
  type UsageDay,
  type UsageFailure,
  type UsageModel,
  type UsageQuestion,
  type UsageReport,
  type UsageTotals,
  type UsageUser,
  type User,
} from "@simha/shared";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

const SETTINGS_KEY = "usage_prices";
const SLOWEST_LIMIT = 10;
const EXPORT_LIMIT = 50_000;
/** Guard against a hand-edited URL asking for years of days. */
const MAX_DAYS = 366;

interface UsageFilter {
  /** YYYY-MM-DD, inclusive. */
  readonly from: string;
  /** YYYY-MM-DD, inclusive. */
  readonly to: string;
}

export interface UsageService {
  readonly report: (filter: UsageFilter) => Effect.Effect<UsageReport>;
  /** Every run of the period, one CSV row each, newest first. */
  readonly csv: (filter: UsageFilter) => Effect.Effect<string>;
  /** Upserts prices; saved rows for other models stay. Returns the effective book. */
  readonly setPrices: (book: PriceBook, actor: User) => Effect.Effect<PriceBook>;
}

const EMPTY_BOOK: PriceBook = { usdIdr: 0, models: [] };

/** API types are readonly; the accumulators below are filled in place. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const round = (value: number, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** USD per 1M tokens: finite, not negative, and not silly. */
const clampPrice = (value: number) => (Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, value)) : 0);

/** Rupiah per USD: finite and not negative (0 = show USD only). */
const clampRate = (value: number) => (Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, value)) : 0);

/** Every YYYY-MM-DD from `from` to `to`, so the chart has a point for quiet days too. */
export const daysBetween = (from: string, to: string): ReadonlyArray<string> => {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days: Array<string> = [];
  for (let time = start; time <= end && days.length < MAX_DAYS; time += 86_400_000) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
};

const emptyTotals = (): Mutable<UsageTotals> => ({
  runs: 0,
  ok: 0,
  failed: 0,
  steps: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  cacheHitRate: null,
  durationMs: 0,
  costUsd: 0,
  unpricedRuns: 0,
  noTokenRuns: 0,
  users: 0,
});

const emptyDay = (day: string): Mutable<UsageDay> => ({
  day,
  runs: 0,
  failed: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

interface GroupRow {
  readonly day: string;
  readonly provider: string;
  readonly model: string;
  readonly asked_by: string | null;
  readonly runs: number;
  readonly ok: number;
  readonly error: number;
  readonly interrupted: number;
  readonly steps: number;
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly cache_write_tokens: number;
  readonly output_tokens: number;
  readonly duration_ms: number;
  readonly no_token_runs: number;
}

interface SlowRow {
  readonly id: string;
  readonly question: string;
  readonly asked_by: string | null;
  readonly provider: string;
  readonly model: string;
  readonly status: string;
  readonly steps: number;
  readonly input_tokens: number | null;
  readonly cached_input_tokens: number | null;
  readonly cache_write_tokens: number | null;
  readonly output_tokens: number | null;
  readonly duration_ms: number | null;
  readonly started_at: string;
}

interface FailureRow {
  readonly provider: string;
  readonly model: string;
  readonly errors: number;
  readonly interrupted: number;
  readonly last_error: string | null;
  readonly last_at: string | null;
}

interface ExportRow {
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly asked_by: string | null;
  readonly mode: string;
  readonly provider: string;
  readonly model: string;
  readonly status: string;
  readonly steps: number;
  readonly input_tokens: number | null;
  readonly cached_input_tokens: number | null;
  readonly cache_write_tokens: number | null;
  readonly output_tokens: number | null;
  readonly question: string;
  readonly error: string | null;
  readonly duration_ms: number | null;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const savedBook = sql<{ value_json: string }>`
    SELECT value_json FROM settings WHERE key = ${SETTINGS_KEY}`.pipe(
    Effect.map((rows): PriceBook => {
      if (!rows[0]) return EMPTY_BOOK;
      try {
        const parsed = JSON.parse(rows[0].value_json) as Partial<PriceBook>;
        return {
          usdIdr: typeof parsed.usdIdr === "number" && Number.isFinite(parsed.usdIdr) ? Math.max(0, parsed.usdIdr) : 0,
          models: Array.isArray(parsed.models) ? parsed.models : [],
        };
      } catch {
        return EMPTY_BOOK;
      }
    }),
    Effect.orDie,
  );

  const setPrices = (book: PriceBook, actor: User) =>
    Effect.gen(function* () {
      const current = yield* savedBook;
      const merged = [...current.models];
      for (const raw of book.models) {
        // A hand-edited body or a bad gateway must not turn the estimate into
        // Infinity or a negative bill. Prices are USD per 1M tokens.
        const price: ModelPrice = {
          provider: raw.provider.trim().slice(0, 100),
          model: raw.model.trim().slice(0, 200),
          input: clampPrice(raw.input),
          output: clampPrice(raw.output),
          cachedInput: clampPrice(raw.cachedInput),
          cacheWrite: clampPrice(raw.cacheWrite),
        };
        if (price.provider === "" || price.model === "") continue;
        const index = merged.findIndex(
          (saved) =>
            saved.provider.trim().toLowerCase() === price.provider.toLowerCase() &&
            saved.model.trim().toLowerCase() === price.model.toLowerCase(),
        );
        if (index >= 0) merged[index] = price;
        else merged.push(price);
      }
      const next: PriceBook = { usdIdr: clampRate(book.usdIdr), models: merged };
      yield* sql`
        INSERT INTO settings (key, value_json, updated_by, updated_at)
        VALUES (${SETTINGS_KEY}, ${JSON.stringify(next)}, ${actor.username}, ${new Date().toISOString()})
        ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by,
          updated_at = excluded.updated_at`;
      return next;
    }).pipe(Effect.orDie);

  const report = (filter: UsageFilter) =>
    Effect.gen(function* () {
      const book = yield* savedBook;
      const groups = yield* sql<GroupRow>`
        SELECT date(started_at, 'localtime') AS day, provider, model, asked_by,
          COUNT(*) AS runs,
          SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
          SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
          COALESCE(SUM(steps), 0) AS steps,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
          COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(CASE WHEN finished_at IS NOT NULL
            THEN (julianday(finished_at) - julianday(started_at)) * 86400000 ELSE 0 END), 0) AS duration_ms,
          SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END) AS no_token_runs
        FROM agent_runs
        WHERE date(started_at, 'localtime') BETWEEN ${filter.from} AND ${filter.to}
        GROUP BY day, provider, model, asked_by
        ORDER BY day`;

      const dayMap = new Map(daysBetween(filter.from, filter.to).map((day) => [day, emptyDay(day)]));
      const modelMap = new Map<string, Mutable<UsageModel>>();
      const userMap = new Map<string | null, Mutable<UsageUser>>();
      const userNames = new Set<string>();
      const totals = emptyTotals();

      for (const row of groups) {
        const price = priceFor(row.provider, row.model, book.models);
        const tokens = {
          inputTokens: row.input_tokens,
          cachedInputTokens: row.cached_input_tokens,
          cacheWriteTokens: row.cache_write_tokens,
          outputTokens: row.output_tokens,
        };
        const cost = costUsdOf(price, tokens);
        const failed = row.error + row.interrupted;
        const unpriced = price === null ? row.runs : 0;

        totals.runs += row.runs;
        totals.ok += row.ok;
        totals.failed += failed;
        totals.steps += row.steps;
        totals.inputTokens += row.input_tokens;
        totals.cachedInputTokens += row.cached_input_tokens;
        totals.cacheWriteTokens += row.cache_write_tokens;
        totals.outputTokens += row.output_tokens;
        totals.durationMs += row.duration_ms;
        totals.costUsd += cost;
        totals.unpricedRuns += unpriced;
        totals.noTokenRuns += row.no_token_runs;
        if (row.asked_by !== null) userNames.add(row.asked_by);

        const day = dayMap.get(row.day);
        if (day) {
          day.runs += row.runs;
          day.failed += failed;
          day.inputTokens += row.input_tokens;
          day.cachedInputTokens += row.cached_input_tokens;
          day.cacheWriteTokens += row.cache_write_tokens;
          day.outputTokens += row.output_tokens;
          day.costUsd += cost;
        }

        const modelKey = `${row.provider}\u0000${row.model}`;
        const model = modelMap.get(modelKey) ?? {
          provider: row.provider,
          model: row.model,
          runs: 0,
          failed: 0,
          steps: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          cacheHitRate: null,
          costUsd: 0,
          unpricedRuns: 0,
          noTokenRuns: 0,
        };
        model.runs += row.runs;
        model.failed += failed;
        model.steps += row.steps;
        model.inputTokens += row.input_tokens;
        model.cachedInputTokens += row.cached_input_tokens;
        model.cacheWriteTokens += row.cache_write_tokens;
        model.outputTokens += row.output_tokens;
        model.costUsd += cost;
        model.unpricedRuns += unpriced;
        model.noTokenRuns += row.no_token_runs;
        modelMap.set(modelKey, model);

        const user = userMap.get(row.asked_by) ?? {
          user: row.asked_by,
          runs: 0,
          failed: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedRuns: 0,
        };
        user.runs += row.runs;
        user.failed += failed;
        user.inputTokens += row.input_tokens;
        user.outputTokens += row.output_tokens;
        user.costUsd += cost;
        user.unpricedRuns += unpriced;
        userMap.set(row.asked_by, user);
      }

      const slowest = yield* sql<SlowRow>`
        SELECT id, question, asked_by, provider, model, status, steps,
          input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
          (julianday(finished_at) - julianday(started_at)) * 86400000 AS duration_ms,
          started_at
        FROM agent_runs
        WHERE finished_at IS NOT NULL AND date(started_at, 'localtime') BETWEEN ${filter.from} AND ${filter.to}
        ORDER BY duration_ms DESC
        LIMIT ${SLOWEST_LIMIT}`;

      const failures = yield* sql<FailureRow>`
        SELECT r.provider, r.model,
          SUM(CASE WHEN r.status = 'error' THEN 1 ELSE 0 END) AS errors,
          SUM(CASE WHEN r.status = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
          MAX(r.started_at) AS last_at,
          (SELECT x.error FROM agent_runs x
            WHERE x.provider = r.provider AND x.model = r.model
              AND x.error IS NOT NULL AND date(x.started_at, 'localtime') BETWEEN ${filter.from} AND ${filter.to}
            ORDER BY x.started_at DESC LIMIT 1) AS last_error
        FROM agent_runs r
        WHERE r.status <> 'ok' AND date(r.started_at, 'localtime') BETWEEN ${filter.from} AND ${filter.to}
        GROUP BY r.provider, r.model
        ORDER BY (errors + interrupted) DESC, last_at DESC`;

      totals.cacheHitRate = cacheHitRateOf(totals.inputTokens, totals.cachedInputTokens);
      totals.durationMs = Math.round(totals.durationMs);
      totals.costUsd = round(totals.costUsd);
      totals.users = userNames.size;

      const models = [...modelMap.values()]
        .map((model) => ({
          ...model,
          cacheHitRate: cacheHitRateOf(model.inputTokens, model.cachedInputTokens),
          costUsd: round(model.costUsd),
        }))
        .toSorted((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);

      const users = [...userMap.values()]
        .map((user) => ({ ...user, costUsd: round(user.costUsd) }))
        .toSorted((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);

      const days = [...dayMap.values()].map((day) => ({ ...day, costUsd: round(day.costUsd) }));

      // Only the prices this report actually used, so the dialog can edit them.
      const used = models
        .map((model) => priceFor(model.provider, model.model, book.models))
        .filter((price): price is ModelPrice => price !== null);

      return {
        from: filter.from,
        to: filter.to,
        totals,
        days,
        models,
        users,
        slowest: slowest.map(
          (row): UsageQuestion => {
            const price = priceFor(row.provider, row.model, book.models);
            const cost =
              price === null || row.input_tokens === null || row.output_tokens === null
                ? null
                : round(
                    costUsdOf(price, {
                      inputTokens: row.input_tokens,
                      cachedInputTokens: row.cached_input_tokens ?? 0,
                      cacheWriteTokens: row.cache_write_tokens ?? 0,
                      outputTokens: row.output_tokens,
                    }),
                  );
            return {
              id: row.id,
              question: row.question,
              askedBy: row.asked_by,
              provider: row.provider,
              model: row.model,
              status: row.status,
              steps: row.steps,
              inputTokens: row.input_tokens,
              outputTokens: row.output_tokens,
              costUsd: cost,
              durationMs: Math.max(0, Math.round(row.duration_ms ?? 0)),
              startedAt: row.started_at,
            };
          },
        ),
        failures: failures.map(
          (row): UsageFailure => ({
            provider: row.provider,
            model: row.model,
            errors: row.errors,
            interrupted: row.interrupted,
            lastError: row.last_error,
            lastAt: row.last_at,
          }),
        ),
        prices: { usdIdr: book.usdIdr, models: used },
      } satisfies UsageReport;
    }).pipe(Effect.orDie);

  const csv = (filter: UsageFilter) =>
    Effect.gen(function* () {
      const book = yield* savedBook;
      const rows = yield* sql<ExportRow>`
        SELECT started_at, finished_at, asked_by, mode, provider, model, status, steps,
          input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, question, error,
          (julianday(finished_at) - julianday(started_at)) * 86400000 AS duration_ms
        FROM agent_runs
        WHERE date(started_at, 'localtime') BETWEEN ${filter.from} AND ${filter.to}
        ORDER BY started_at DESC
        LIMIT ${EXPORT_LIMIT}`;
      const columns = [
        "mulai",
        "selesai",
        "pengguna",
        "mode",
        "provider",
        "model",
        "status",
        "langkah",
        "token_masuk",
        "token_cache_baca",
        "token_cache_tulis",
        "token_keluar",
        "biaya_usd",
        "durasi_detik",
        "pertanyaan",
        "error",
      ];
      return toCsv(
        columns,
        rows.map((row) => {
          const price = priceFor(row.provider, row.model, book.models);
          const cost =
            price === null || row.input_tokens === null || row.output_tokens === null
              ? ""
              : round(
                  costUsdOf(price, {
                    inputTokens: row.input_tokens,
                    cachedInputTokens: row.cached_input_tokens ?? 0,
                    cacheWriteTokens: row.cache_write_tokens ?? 0,
                    outputTokens: row.output_tokens,
                  }),
                ).toFixed(6);
          return {
            mulai: row.started_at,
            selesai: row.finished_at ?? "",
            pengguna: row.asked_by ?? "",
            mode: row.mode,
            provider: row.provider,
            model: row.model,
            status: row.status,
            langkah: row.steps,
            token_masuk: row.input_tokens ?? "",
            token_cache_baca: row.cached_input_tokens ?? "",
            token_cache_tulis: row.cache_write_tokens ?? "",
            token_keluar: row.output_tokens ?? "",
            biaya_usd: cost,
            durasi_detik: row.duration_ms === null ? "" : (row.duration_ms / 1000).toFixed(1),
            pertanyaan: row.question,
            error: row.error ?? "",
          };
        }),
      );
    }).pipe(Effect.orDie);

  return { report, csv, setPrices } satisfies UsageService;
});

export class Usage extends Context.Service<Usage, UsageService>()("simha/Usage") {}

/** Needs the audit DB's SqlClient (AuditLogLive / AuditLogMemory). */
export const UsageLive = Layer.effect(Usage, make);

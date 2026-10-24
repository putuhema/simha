/**
 * Cost estimation for AI runs: USD per 1 million tokens.
 *
 * The built-in table is a starting point, not a bill. Providers change prices,
 * gateways add a margin and self-hosted models are free, so every row can be
 * replaced by the admin on Pengaturan → Pemakaian AI (stored with the audit
 * DB). The page always shows the unit prices it used.
 */
import type { ModelPrice } from "./api.ts";

/** Example: `claude-opus-4-1`. The first matching fragment wins, so specific entries come first. */
export const BUILT_IN_PRICES: ReadonlyArray<readonly [string, Omit<ModelPrice, "provider" | "model">]> = [
  ["claude-opus", { input: 15, output: 75, cachedInput: 1.5, cacheWrite: 18.75 }],
  ["claude-sonnet", { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 }],
  ["claude-haiku", { input: 1, output: 5, cachedInput: 0.1, cacheWrite: 1.25 }],
  ["gpt-4o-mini", { input: 0.15, output: 0.6, cachedInput: 0.075, cacheWrite: 0 }],
  ["gpt-4o", { input: 2.5, output: 10, cachedInput: 1.25, cacheWrite: 0 }],
  ["gpt-4.1-mini", { input: 0.4, output: 1.6, cachedInput: 0.1, cacheWrite: 0 }],
  ["gpt-4.1", { input: 2, output: 8, cachedInput: 0.5, cacheWrite: 0 }],
  ["deepseek", { input: 0.27, output: 1.1, cachedInput: 0.07, cacheWrite: 0 }],
  ["gemini-2.5-pro", { input: 1.25, output: 10, cachedInput: 0.31, cacheWrite: 0 }],
  ["gemini-2.5-flash", { input: 0.3, output: 2.5, cachedInput: 0.075, cacheWrite: 0 }],
];

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * The price for one model: the saved book first (same provider+model, then a
 * saved row for the same model under another gateway), then the built-in
 * table. Null when nobody priced it, so the page can say cost is incomplete
 * instead of showing a made-up zero.
 */
export const priceFor = (
  provider: string,
  model: string,
  saved: ReadonlyArray<ModelPrice> = [],
): ModelPrice | null => {
  const p = normalize(provider);
  const m = normalize(model);
  const exact = saved.find((price) => normalize(price.provider) === p && normalize(price.model) === m);
  if (exact) return exact;
  const sameModel = saved.find((price) => normalize(price.model) === m);
  if (sameModel) return sameModel;
  const builtIn = BUILT_IN_PRICES.find(([fragment]) => m.includes(fragment));
  return builtIn ? { provider, model, ...builtIn[1] } : null;
};

export interface TokenUsage {
  /** Total input, including tokens read from and written to the prompt cache. */
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

/** Estimated USD for one run or a group. 0 when there is no price (callers track that separately). */
export const costUsdOf = (price: ModelPrice | null, usage: TokenUsage): number => {
  if (price === null) return 0;
  // `inputTokens` is the total, so subtracting the cached parts must not go below zero.
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens);
  return (
    (uncachedInput * price.input +
      usage.cachedInputTokens * price.cachedInput +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.outputTokens * price.output) /
    1_000_000
  );
};

/** Cached share of the input tokens, 0–1; null when no input was recorded. */
export const cacheHitRateOf = (inputTokens: number, cachedInputTokens: number): number | null =>
  inputTokens > 0 ? Math.min(1, Math.max(0, cachedInputTokens / inputTokens)) : null;

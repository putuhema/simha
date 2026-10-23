/**
 * The AI provider in use, changeable on the settings page without a restart.
 *
 * Settings start from .env (LLM_*). Saving them in the app stores them in the
 * audit DB (`settings` table, key "llm"), and they override .env from then on.
 * The API key is stored there too, so keep data/audit.sqlite readable only by
 * the server account. It is never sent back to the browser.
 *
 * `LlmClient` is provided as a thin proxy over the current adapter, so the
 * agent picks up a new provider on its next question. A broken configuration
 * does not stop the server: questions fail with the configuration error until
 * an admin fixes it.
 */
import {
  LlmClient,
  LlmError,
  LlmSettingsConfig,
  makeLlmClient,
  type LlmClientService,
  type LlmSettings as Settings,
} from "@simha/llm";
import type { LlmSettingsView, LlmTestResult, UpdateLlmSettingsRequest, User } from "@simha/shared";
import { Context, Duration, Effect, Layer, Redacted, Stream } from "effect";
import { SqlClient } from "effect/sql";

const KEY = "llm";
const TEST_TIMEOUT = Duration.seconds(30);

interface Stored {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly maskPii: boolean;
}

const toSettings = (s: Stored): Settings => ({
  provider: s.provider,
  model: s.model,
  baseUrl: s.baseUrl ?? undefined,
  apiKey: s.apiKey ? Redacted.make(s.apiKey) : undefined,
  maskPii: s.maskPii,
});

/** A client that explains why the AI is not available. */
const failingClient = (settings: Settings, message: string): LlmClientService => ({
  info: { provider: settings.provider, adapter: "openai-compat", model: settings.model, maskPii: settings.maskPii },
  chat: () =>
    Stream.fail(new LlmError({ provider: settings.provider, message: `Pengaturan AI belum benar: ${message}`, retryable: false })),
});

const build = (settings: Settings) =>
  makeLlmClient(settings).pipe(Effect.catch((e) => Effect.succeed(failingClient(settings, e.message))));

export interface LlmSettingsOptions {
  /** Settings from .env. */
  readonly env: Settings;
  /** Use this client while no settings were saved in the app (tests use a scripted fake). */
  readonly initialClient?: LlmClientService | undefined;
}

const make = (options: LlmSettingsOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ value_json: string; updated_by: string; updated_at: string }>`
      SELECT value_json, updated_by, updated_at FROM settings WHERE key = ${KEY}`.pipe(Effect.orDie);

    let settings = row ? toSettings(JSON.parse(row.value_json) as Stored) : options.env;
    let meta = row ? { source: "app" as const, updatedBy: row.updated_by, updatedAt: row.updated_at } : null;
    let client = row || !options.initialClient ? yield* build(settings) : options.initialClient;

    const proxy: LlmClientService = {
      get info() {
        return client.info;
      },
      chat: (request) => Stream.suspend(() => client.chat(request)),
    };

    const view = (): LlmSettingsView => ({
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl ?? null,
      maskPii: settings.maskPii,
      apiKeySet: settings.apiKey !== undefined,
      source: meta?.source ?? "env",
      updatedBy: meta?.updatedBy ?? null,
      updatedAt: meta?.updatedAt ?? null,
    });

    /** The request applied to the current settings (an absent API key keeps the current one). */
    const merge = (input: UpdateLlmSettingsRequest): Settings => ({
      provider: input.provider.trim().toLowerCase(),
      model: input.model.trim(),
      baseUrl: input.baseUrl?.trim() || undefined,
      apiKey: input.apiKey === undefined ? settings.apiKey : input.apiKey === "" ? undefined : Redacted.make(input.apiKey),
      maskPii: input.maskPii,
    });

    /** Saves and switches. Fails with the configuration error when the settings cannot work. */
    const update = (input: UpdateLlmSettingsRequest, actor: User) =>
      Effect.gen(function* () {
        const next = merge(input);
        const nextClient = yield* makeLlmClient(next).pipe(Effect.mapError((e) => e.message));
        const stored: Stored = {
          provider: next.provider,
          model: next.model,
          baseUrl: next.baseUrl ?? null,
          apiKey: next.apiKey ? Redacted.value(next.apiKey) : null,
          maskPii: next.maskPii,
        };
        const at = new Date().toISOString();
        yield* sql`
          INSERT INTO settings (key, value_json, updated_by, updated_at)
          VALUES (${KEY}, ${JSON.stringify(stored)}, ${actor.username}, ${at})
          ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`.pipe(Effect.orDie);
        settings = next;
        client = nextClient;
        meta = { source: "app", updatedBy: actor.username, updatedAt: at };
        return view();
      });

    /** Sends one short message with the given settings, without saving them. */
    const test = (input: UpdateLlmSettingsRequest) =>
      Effect.gen(function* () {
        const started = performance.now();
        const result = yield* makeLlmClient(merge(input)).pipe(
          Effect.flatMap((candidate) =>
            candidate
              .chat({
                system: "Jawab sangat singkat dalam bahasa Indonesia.",
                messages: [{ role: "user", text: "Tes koneksi. Balas dengan satu kata: siap" }],
                tools: [],
              })
              .pipe(
                Stream.runFold(
                  () => "",
                  (text, event) => (event.type === "text_delta" ? text + event.text : text),
                ),
                Effect.timeoutOrElse({
                  duration: TEST_TIMEOUT,
                  orElse: () => Effect.fail({ message: "Tidak ada jawaban dalam 30 detik." }),
                }),
              ),
          ),
          Effect.match({
            onSuccess: (reply) => ({ ok: true, reply: reply.trim() || "(jawaban kosong)", error: null }),
            onFailure: (e) => ({ ok: false, reply: null, error: e.message }),
          }),
        );
        return { ...result, durationMs: Math.round(performance.now() - started) } satisfies LlmTestResult;
      });

    return { client: proxy, view: Effect.sync(view), update, test };
  });

export class LlmSettingsService extends Context.Service<LlmSettingsService, Effect.Success<ReturnType<typeof make>>>()(
  "simha/LlmSettings",
) {}

/** LlmSettingsService plus LlmClient (the proxy). Needs the audit DB's SqlClient. */
export const llmSettingsLayer = (options: LlmSettingsOptions) => {
  const settings = Layer.effect(LlmSettingsService, make(options));
  const client = Layer.effect(
    LlmClient,
    Effect.gen(function* () {
      return (yield* LlmSettingsService).client;
    }),
  );
  return client.pipe(Layer.provideMerge(settings));
};

/** From .env. */
export const LlmSettingsLive = Layer.unwrap(Effect.map(LlmSettingsConfig, (env) => llmSettingsLayer({ env })));

import { Config, Context, Effect, Layer } from "effect";
import * as NodePath from "node:path";

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..", "..");

/**
 * Where the HTTP server listens. Defaults to this computer only; set
 * SERVER_HOST=0.0.0.0 to serve the hospital network (everyone must log in).
 */
export const ServerConfig = Config.all({
  host: Config.String("SERVER_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.Port("SERVER_PORT").pipe(Config.withDefault(8787)),
});

/** HTTP behaviour that tests and the desktop app may change. */
export const HttpConfig = Config.all({
  /** Built web UI (`pnpm --filter @simrs/web build`), served at `/`. Relative to the repo root. */
  webDir: Config.String("WEB_DIST_DIR").pipe(
    Config.withDefault("apps/web/dist"),
    Config.map((dir) => NodePath.resolve(repoRoot, dir)),
  ),
  /** Mark the session cookie Secure. Turn on when the server is behind HTTPS. */
  secureCookie: Config.Boolean("COOKIE_SECURE").pipe(Config.withDefault(false)),
});
export class HttpSettings extends Context.Service<HttpSettings, Config.Success<typeof HttpConfig>>()(
  "simrs/HttpSettings",
) {}

export const HttpSettingsLive = Layer.effect(
  HttpSettings,
  Effect.gen(function* () {
    return yield* HttpConfig;
  }),
);

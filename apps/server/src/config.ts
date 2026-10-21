import { Config } from "effect";

/**
 * Where the HTTP server listens. Defaults to this computer only; set
 * SERVER_HOST=0.0.0.0 to serve the hospital network (login comes in M5).
 */
export const ServerConfig = Config.all({
  host: Config.String("SERVER_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.Port("SERVER_PORT").pipe(Config.withDefault(8787)),
});

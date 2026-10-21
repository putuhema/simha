/**
 * SIMRS Harness server.
 *
 *   pnpm start   (from the repo root)
 */
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { LlmClientLive } from "@simrs/llm";
import { AuditLogLive, KhanzaReadLive } from "@simrs/tools";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { createServer } from "node:http";
import { AgentLive } from "./agent/Agent.ts";
import { SystemPromptLive } from "./agent/prompt.ts";
import { ServerConfig } from "./config.ts";
import { Routes } from "./http/routes.ts";
import { StoreLive } from "./store.ts";

/** Everything the routes need: audit DB, Khanza (read only), AI provider, agent. */
export const AppLive = AgentLive.pipe(
  Layer.provideMerge(Layer.mergeAll(StoreLive, KhanzaReadLive, LlmClientLive, SystemPromptLive)),
  Layer.provideMerge(AuditLogLive),
  Layer.provide(NodeFileSystem.layer),
);

const HttpLive = Layer.unwrap(
  Effect.map(ServerConfig, ({ host, port }) =>
    HttpRouter.serve(Routes).pipe(Layer.provide(NodeHttpServer.layer(createServer, { host, port }))),
  ),
);

if (import.meta.main) {
  HttpLive.pipe(Layer.provide(AppLive), Layer.launch, NodeRuntime.runMain);
}

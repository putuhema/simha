/**
 * SIMRS Harness server.
 *
 *   pnpm start   (from the repo root)
 */
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { LlmClientLive } from "@simrs/llm";
import { AuditLogLive, FixStoreLive, KhanzaReadLive, KhanzaWriteLive } from "@simrs/tools";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { createServer } from "node:http";
import { AgentLive } from "./agent/Agent.ts";
import { FixExecutorLive } from "./fixes/FixExecutor.ts";
import { SystemPromptLive } from "./agent/prompt.ts";
import { ServerConfig } from "./config.ts";
import { Routes } from "./http/routes.ts";
import { StoreLive } from "./store.ts";

/**
 * Everything the routes need: audit DB, Khanza read pool, AI provider, agent,
 * and the fix executor (the only user of the Khanza write pool).
 */
export const AppLive = Layer.mergeAll(AgentLive, FixExecutorLive).pipe(
  Layer.provideMerge(Layer.mergeAll(StoreLive, FixStoreLive, KhanzaReadLive, KhanzaWriteLive, LlmClientLive, SystemPromptLive)),
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

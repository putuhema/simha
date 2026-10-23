/**
 * Simha server.
 *
 *   pnpm start   (from the repo root)
 */
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { AppDocsLive, AuditLogLive, BerkasLive, FixStoreLive, KhanzaReadLive, KhanzaWriteLive, PacsLive, KnowledgeStoreLive, ResultStoreLive, SchemaDocsLive } from "@simha/tools";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { createServer } from "node:http";
import { AgentLive } from "./agent/Agent.ts";
import { AuthLive } from "./auth/Auth.ts";
import { FixExecutorLive } from "./fixes/FixExecutor.ts";
import { SystemPromptLive } from "./agent/prompt.ts";
import { HttpSettingsLive, ServerConfig } from "./config.ts";
import { Routes } from "./http/routes.ts";
import { LlmSettingsLive } from "./llm/LlmSettings.ts";
import { StoreLive } from "./store.ts";
import { ViewsLive } from "./views.ts";

/**
 * Everything the routes need: audit DB, Khanza read pool, AI provider, agent, PACS,
 * login, and the fix executor (the only user of the Khanza write pool).
 */
export const AppLive = Layer.mergeAll(AgentLive, FixExecutorLive, ViewsLive).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      StoreLive,
      FixStoreLive,
      KnowledgeStoreLive,
      ResultStoreLive,
      SchemaDocsLive,
      AppDocsLive,
      AuthLive,
      HttpSettingsLive,
      KhanzaReadLive,
      KhanzaWriteLive,
      LlmSettingsLive,
      PacsLive,
      BerkasLive,
      SystemPromptLive,
    ),
  ),
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

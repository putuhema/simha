/**
 * Simha server.
 *
 *   pnpm start   (from the repo root)
 */
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { AppDocsLive, AuditLogLive, BerkasLive, CheckStoreLive, FixStoreLive, KhanzaReadLive, KhanzaWriteLive, PacsLive, KnowledgeStoreLive, ResultStoreLive, SchemaDocsLive } from "@simha/tools";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { createServer } from "node:http";
import { AgentLive } from "./agent/Agent.ts";
import { AuthLive } from "./auth/Auth.ts";
import { KhanzaAccountsLive } from "./auth/KhanzaAccounts.ts";
import { FixExecutorLive } from "./fixes/FixExecutor.ts";
import { SystemPromptLive } from "./agent/prompt.ts";
import { ChecksSettingsLive, HttpSettingsLive, ServerConfig } from "./config.ts";
import { Routes } from "./http/routes.ts";
import { LlmSettingsLive } from "./llm/LlmSettings.ts";
import { StoreLive } from "./store.ts";
import { UsageLive } from "./usage.ts";
import { ViewsLive } from "./views.ts";
import { ChecksLive } from "./checks/Checks.ts";
import { ChecksSchedulerLive } from "./checks/scheduler.ts";

/**
 * Everything the routes need: audit DB, Khanza read pool, AI provider, agent, PACS,
 * login, and the fix executor (the only user of the Khanza write pool).
 */
const KhanzaAuthLive = KhanzaAccountsLive.pipe(Layer.provideMerge(KhanzaReadLive));
const AuthWithKhanzaLive = AuthLive.pipe(Layer.provideMerge(KhanzaAuthLive));

// The timer uses the same Checks instance the HTTP routes use.
const ChecksWithScheduler = ChecksSchedulerLive.pipe(Layer.provideMerge(ChecksLive));

export const AppLive = Layer.mergeAll(AgentLive, FixExecutorLive, ViewsLive, UsageLive, ChecksWithScheduler).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      StoreLive,
      CheckStoreLive,
      FixStoreLive,
      KnowledgeStoreLive,
      ResultStoreLive,
      SchemaDocsLive,
      AppDocsLive,
      AuthWithKhanzaLive,
      HttpSettingsLive,
      ChecksSettingsLive,
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

/**
 * HTTP API. Request bodies are checked against the Schemas in @simrs/shared.
 *
 *   GET  /health                    server, Khanza and AI model status
 *   POST /tickets                   create a ticket
 *   GET  /tickets                   list tickets (newest first)
 *   GET  /tickets/:id               one ticket
 *   POST /tickets/:id/investigate   run the agent on a ticket (SSE)
 *   POST /ask                       Tanya Data question (SSE)
 *   GET  /fixes                     list fixes (?status=pending&ticketId=...)
 *   POST /fixes                     propose a fix by hand (same checks as the AI tool)
 *   GET  /fixes/:id                 fix with preview rows and history
 *   POST /fixes/:id/approve         approve and run it (write user, one transaction)
 *   POST /fixes/:id/reject          reject it
 *   POST /fixes/:id/rollback        restore the rows it changed
 */
import { LlmClient } from "@simrs/llm";
import {
  AskRequest,
  CreateFixRequest,
  CreateTicketRequest,
  FixActionRequest,
  FixStatus,
  InvestigateRequest,
  RejectFixRequest,
} from "@simrs/shared";
import { FixStore, KhanzaRead, planFix } from "@simrs/tools";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Agent } from "../agent/Agent.ts";
import { FixExecutor, type FixActionError } from "../fixes/FixExecutor.ts";
import { Store } from "../store.ts";
import { sseResponse } from "./sse.ts";

const errorResponse = (status: number, error: string) => HttpServerResponse.jsonUnsafe({ error }, { status });

/** Decodes the JSON body; a bad body becomes a 400 with the Schema message. */
const body = <A>(schema: Schema.Codec<A, unknown>) =>
  HttpServerRequest.schemaBodyJson(schema).pipe(
    Effect.mapError((e) => (Schema.isSchemaError(e) ? e.message : "Body harus berupa JSON yang valid.")),
  );

/** Empty body allowed (e.g. POST /tickets/:id/investigate with no follow-up question). */
const optionalBody = <A>(schema: Schema.Codec<A, unknown>, empty: A) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const text = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
    if (text.trim() === "") return empty;
    const json = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => "Body harus berupa JSON yang valid." });
    return yield* Schema.decodeUnknownEffect(schema)(json).pipe(Effect.mapError((e) => e.message));
  });

const withBadRequest = <R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, string, R>) =>
  effect.pipe(Effect.catch((message: string) => Effect.succeed(errorResponse(400, message))));

const ticketId = HttpRouter.params.pipe(Effect.map((p) => p["id"] ?? ""));
const fixId = ticketId;

/** Approve / reject / rollback outcome: the fix, or the reason it was refused. */
const fixAction = <R>(effect: Effect.Effect<unknown, FixActionError | string, R>) =>
  effect.pipe(
    Effect.map((fix) => HttpServerResponse.jsonUnsafe(fix)),
    Effect.catch((e: FixActionError | string) =>
      Effect.succeed(typeof e === "string" ? errorResponse(400, e) : errorResponse(e.status, e.message)),
    ),
  );

export const Routes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/health",
    Effect.gen(function* () {
      const read = yield* KhanzaRead;
      const llm = yield* LlmClient;
      return HttpServerResponse.jsonUnsafe({
        ok: true,
        khanza: { connected: true, readOnly: true, server: read.server },
        llm: llm.info,
      });
    }),
  ),

  HttpRouter.add(
    "POST",
    "/tickets",
    withBadRequest(
      Effect.gen(function* () {
        const input = yield* body(CreateTicketRequest);
        const ticket = yield* (yield* Store).createTicket(input);
        return HttpServerResponse.jsonUnsafe(ticket, { status: 201 });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/tickets",
    Effect.gen(function* () {
      return HttpServerResponse.jsonUnsafe(yield* (yield* Store).listTickets);
    }),
  ),

  HttpRouter.add(
    "GET",
    "/tickets/:id",
    Effect.gen(function* () {
      const ticket = yield* (yield* Store).getTicket(yield* ticketId);
      return ticket ? HttpServerResponse.jsonUnsafe(ticket) : errorResponse(404, "Tiket tidak ditemukan.");
    }),
  ),

  HttpRouter.add(
    "POST",
    "/tickets/:id/investigate",
    withBadRequest(
      Effect.gen(function* () {
        const input = yield* optionalBody(InvestigateRequest, {});
        const ticket = yield* (yield* Store).getTicket(yield* ticketId);
        if (!ticket) return errorResponse(404, "Tiket tidak ditemukan.");
        const agent = yield* Agent;
        return sseResponse(agent.run({ kind: "ticket", ticket, question: input.question }));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/ask",
    withBadRequest(
      Effect.gen(function* () {
        const input = yield* body(AskRequest);
        const agent = yield* Agent;
        return sseResponse(agent.run({ kind: "ask", question: input.question, conversationId: input.conversationId }));
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/fixes",
    withBadRequest(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const query = new URL(request.url, "http://local").searchParams;
        const status = query.get("status") ?? undefined;
        if (status !== undefined && !Schema.is(FixStatus)(status)) return yield* Effect.fail(`Status tidak dikenal: ${status}`);
        const fixes = yield* (yield* FixStore).list({ status, ticketId: query.get("ticketId") ?? undefined });
        return HttpServerResponse.jsonUnsafe(fixes);
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/fixes",
    withBadRequest(
      Effect.gen(function* () {
        const input = yield* body(CreateFixRequest);
        const fix = yield* planFix(
          "POST /fixes",
          { title: input.title, reason: input.reason, sql: input.sql, params: input.params ?? [] },
          { runId: null, toolCallId: null, createdBy: input.createdBy, ticketId: input.ticketId ?? null },
        ).pipe(Effect.mapError((e) => e.message));
        return HttpServerResponse.jsonUnsafe(fix, { status: 201 });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/fixes/:id",
    Effect.gen(function* () {
      const store = yield* FixStore;
      const id = yield* fixId;
      const fix = yield* store.get(id);
      if (!fix) return errorResponse(404, "Perbaikan tidak ditemukan.");
      return HttpServerResponse.jsonUnsafe({ fix, events: yield* store.events(id) });
    }),
  ),

  HttpRouter.add(
    "POST",
    "/fixes/:id/approve",
    fixAction(
      Effect.gen(function* () {
        const input = yield* body(FixActionRequest);
        return yield* (yield* FixExecutor).approve(yield* fixId, input.actor);
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/fixes/:id/reject",
    fixAction(
      Effect.gen(function* () {
        const input = yield* body(RejectFixRequest);
        return yield* (yield* FixExecutor).reject(yield* fixId, input.actor, input.reason);
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/fixes/:id/rollback",
    fixAction(
      Effect.gen(function* () {
        const input = yield* body(FixActionRequest);
        return yield* (yield* FixExecutor).rollback(yield* fixId, input.actor);
      }),
    ),
  ),
);

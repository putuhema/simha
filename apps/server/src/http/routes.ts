/**
 * HTTP API. Request bodies are checked against the Schemas in @simrs/shared.
 *
 *   GET  /health                    server, Khanza and AI model status
 *   POST /tickets                   create a ticket
 *   GET  /tickets                   list tickets (newest first)
 *   GET  /tickets/:id               one ticket
 *   POST /tickets/:id/investigate   run the agent on a ticket (SSE)
 *   POST /ask                       Tanya Data question (SSE)
 */
import { LlmClient } from "@simrs/llm";
import { AskRequest, CreateTicketRequest, InvestigateRequest } from "@simrs/shared";
import { KhanzaRead } from "@simrs/tools";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Agent } from "../agent/Agent.ts";
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
);

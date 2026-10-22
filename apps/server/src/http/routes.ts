/**
 * HTTP API under /api, plus the web UI at every other path. Request bodies are
 * checked against the Schemas in @simrs/shared. Every route except health,
 * login and first-run setup needs a logged-in user (session cookie); the user
 * is who approves fixes, asks questions and creates tickets in the audit log.
 *
 *   GET    /api/health                   server, Khanza and AI model status (public)
 *   GET    /api/auth/state               logged-in user, or whether setup is needed (public)
 *   POST   /api/auth/setup               create the first admin (only while there are no users)
 *   POST   /api/auth/login | logout
 *   POST   /api/auth/password            change own password
 *   GET    /api/users                    list users (admin)
 *   POST   /api/users                    create a user (admin)
 *   PATCH  /api/users/:id                rename, change role, disable, reset password (admin)
 *   GET    /api/stats                    stat row: registrations today, inpatients, open tickets, pending fixes
 *   POST   /api/tickets                  create a ticket
 *   GET    /api/tickets                  list tickets (newest first)
 *   GET    /api/tickets/:id              one ticket
 *   PATCH  /api/tickets/:id              { status }: close or reopen
 *   GET    /api/tickets/:id/transcript   past investigations (steps, answers, fixes)
 *   POST   /api/tickets/:id/investigate  run the agent on a ticket (SSE)
 *   POST   /api/ask                      Tanya Data question (SSE)
 *   GET    /api/conversations            recent Tanya Data threads (?mine=1)
 *   GET    /api/conversations/:id        one thread with its answers and blocks
 *   GET    /api/patients/:rm             patient card (kartuPasien tool)
 *   GET    /api/fixes                    list fixes (?status=pending&ticketId=...)
 *   POST   /api/fixes                    propose a fix by hand, or edit an AI proposal (`replaces`)
 *   GET    /api/fixes/:id                fix with preview rows and history
 *   POST   /api/fixes/:id/approve        approve and run it (write user, one transaction)
 *   POST   /api/fixes/:id/reject         reject it
 *   POST   /api/fixes/:id/rollback       restore the rows it changed
 *   POST   /api/documents                make a patient document (riwayat, cppt, resume) without the AI
 *   GET    /api/documents/:id            the document's HTML (?download=1 to save it)
 *   GET    /api/favorites                saved questions
 *   POST   /api/favorites                save the question and SQL behind a chat result
 *   DELETE /api/favorites/:id            remove one
 *   POST   /api/favorites/:id/run        re-run it without the AI; returns a render block
 *   GET    /api/settings/llm             AI provider settings (no API key)
 *   PUT    /api/settings/llm             change them (admin)
 *   POST   /api/settings/llm/test        try settings without saving (admin)
 *   GET    /api/audit                    audit log (?kind=runs|tools|queries|fixes|events&q=&from=&to=&limit=&offset=)
 */
import { LlmClient } from "@simrs/llm";
import {
  AskRequest,
  AuditKind,
  ChangePasswordRequest,
  CreateDocumentRequest,
  CreateFavoriteRequest,
  CreateFixRequest,
  CreateTicketRequest,
  CreateUserRequest,
  FixStatus,
  InvestigateRequest,
  LoginRequest,
  RejectFixRequest,
  SetupRequest,
  TicketStatus,
  UpdateLlmSettingsRequest,
  UpdateUserRequest,
  type User,
} from "@simrs/shared";
import { dokumenPasien, FixStore, kartuPasien, KhanzaRead, planFix, ResultStore, runTool } from "@simrs/tools";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Agent } from "../agent/Agent.ts";
import { Auth, AuthError, CurrentUser, SESSION_COOKIE, SESSION_HOURS } from "../auth/Auth.ts";
import { HttpSettings } from "../config.ts";
import { favoriteFromBlock, runFavorite } from "../favorites.ts";
import { FixExecutor, type FixActionError } from "../fixes/FixExecutor.ts";
import { LlmSettingsService } from "../llm/LlmSettings.ts";
import { Store } from "../store.ts";
import { Views } from "../views.ts";
import { sseResponse } from "./sse.ts";
import { serveWebApp } from "./static.ts";

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });
const errorResponse = (status: number, error: string) => json({ error }, status);

/** Decodes the JSON body; a bad body becomes a 400 with the Schema message. */
const body = <A>(schema: Schema.Codec<A, unknown>) =>
  HttpServerRequest.schemaBodyJson(schema).pipe(
    Effect.mapError((e) => (Schema.isSchemaError(e) ? e.message : "Body harus berupa JSON yang valid.")),
  );

/** Empty body allowed (e.g. POST /api/tickets/:id/investigate with no follow-up question). */
const optionalBody = <A>(schema: Schema.Codec<A, unknown>, empty: A) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const text = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
    if (text.trim() === "") return empty;
    const parsed = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => "Body harus berupa JSON yang valid." });
    return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(Effect.mapError((e) => e.message));
  });

/** Turns string failures into 400 and AuthError into its status. */
const handled = <R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, string | AuthError, R>) =>
  effect.pipe(
    Effect.catch((e: string | AuthError) =>
      Effect.succeed(typeof e === "string" ? errorResponse(400, e) : errorResponse(e.status, e.message)),
    ),
  );

const pathParam = (name: string) => HttpRouter.params.pipe(Effect.map((p) => p[name] ?? ""));
const id = pathParam("id");

const searchParams = Effect.map(HttpServerRequest.HttpServerRequest, (r) => new URL(r.url, "http://local").searchParams);

const clientIp = Effect.map(HttpServerRequest.HttpServerRequest, (r) => Option.getOrNull(r.remoteAddress ?? Option.none()));

/**
 * Runs `handler` for a logged-in (and, with `admin`, admin) user, with the
 * user available as CurrentUser. Otherwise 401 / 403.
 */
const authed = <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  options: { readonly admin?: boolean } = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? yield* (yield* Auth).userForToken(token) : undefined;
    if (!user) return errorResponse(401, "Silakan login dulu.");
    if (options.admin && user.role !== "admin") return errorResponse(403, "Hanya admin yang boleh melakukan ini.");
    return yield* handler.pipe(Effect.provideService(CurrentUser, user));
  });

const sessionResponse = (user: User, token: string) =>
  Effect.gen(function* () {
    const { secureCookie } = yield* HttpSettings;
    return HttpServerResponse.setCookieUnsafe(json(user), SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookie,
      path: "/",
      maxAge: `${SESSION_HOURS} hours`,
    });
  });

/** Approve / reject / rollback outcome: the fix, or the reason it was refused. */
const fixAction = <R>(effect: Effect.Effect<unknown, FixActionError | string, R>) =>
  effect.pipe(
    Effect.map((fix) => json(fix)),
    Effect.catch((e: FixActionError | string) =>
      Effect.succeed(typeof e === "string" ? errorResponse(400, e) : errorResponse(e.status, e.message)),
    ),
  );

const route = HttpRouter.add;

const AuthRoutes = Layer.mergeAll(
  route(
    "GET",
    "/api/health",
    Effect.gen(function* () {
      const read = yield* KhanzaRead;
      const llm = yield* LlmClient;
      return json({ ok: true, khanza: { connected: true, readOnly: true, server: read.server }, llm: llm.info });
    }),
  ),

  route(
    "GET",
    "/api/auth/state",
    Effect.gen(function* () {
      const auth = yield* Auth;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const token = request.cookies[SESSION_COOKIE];
      const user = token ? yield* auth.userForToken(token) : undefined;
      return json({ setupNeeded: yield* auth.setupNeeded, user: user ?? null });
    }),
  ),

  route(
    "POST",
    "/api/auth/setup",
    handled(
      Effect.gen(function* () {
        const input = yield* body(SetupRequest);
        const { user, token } = yield* (yield* Auth).setup(input, yield* clientIp);
        return yield* sessionResponse(user, token);
      }),
    ),
  ),

  route(
    "POST",
    "/api/auth/login",
    handled(
      Effect.gen(function* () {
        const input = yield* body(LoginRequest);
        const { user, token } = yield* (yield* Auth).login(input.username, input.password, yield* clientIp);
        return yield* sessionResponse(user, token);
      }),
    ),
  ),

  route(
    "POST",
    "/api/auth/logout",
    authed(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        yield* (yield* Auth).logout(request.cookies[SESSION_COOKIE] ?? "", yield* CurrentUser);
        return HttpServerResponse.expireCookieUnsafe(HttpServerResponse.empty({ status: 204 }), SESSION_COOKIE, { path: "/" });
      }),
    ),
  ),

  route(
    "POST",
    "/api/auth/password",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(ChangePasswordRequest);
          yield* (yield* Auth).changePassword(yield* CurrentUser, input.currentPassword, input.newPassword);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
  ),

  route("GET", "/api/users", authed(Effect.gen(function* () {
      return json(yield* (yield* Auth).listUsers);
    }), { admin: true })),

  route(
    "POST",
    "/api/users",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(CreateUserRequest);
          return json(yield* (yield* Auth).createUser(input, yield* CurrentUser), 201);
        }),
      ),
      { admin: true },
    ),
  ),

  route(
    "PATCH",
    "/api/users/:id",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(UpdateUserRequest);
          return json(yield* (yield* Auth).updateUser(yield* id, input, yield* CurrentUser));
        }),
      ),
      { admin: true },
    ),
  ),
);

const TicketRoutes = Layer.mergeAll(
  route("GET", "/api/stats", authed(Effect.gen(function* () {
      return json(yield* (yield* Views).stats);
    }))),

  route(
    "POST",
    "/api/tickets",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(CreateTicketRequest);
          const user = yield* CurrentUser;
          return json(yield* (yield* Store).createTicket(input, user.username), 201);
        }),
      ),
    ),
  ),

  route("GET", "/api/tickets", authed(Effect.gen(function* () {
      return json(yield* (yield* Store).listTickets);
    }))),

  route(
    "GET",
    "/api/tickets/:id",
    authed(
      Effect.gen(function* () {
        const ticket = yield* (yield* Store).getTicket(yield* id);
        return ticket ? json(ticket) : errorResponse(404, "Tiket tidak ditemukan.");
      }),
    ),
  ),

  route(
    "PATCH",
    "/api/tickets/:id",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(Schema.Struct({ status: TicketStatus }));
          const store = yield* Store;
          const ticketId = yield* id;
          if (!(yield* store.getTicket(ticketId))) return errorResponse(404, "Tiket tidak ditemukan.");
          yield* store.setTicketStatus(ticketId, input.status);
          return json(yield* store.getTicket(ticketId));
        }),
      ),
    ),
  ),

  route(
    "GET",
    "/api/tickets/:id/transcript",
    authed(
      Effect.gen(function* () {
        const ticketId = yield* id;
        if (!(yield* (yield* Store).getTicket(ticketId))) return errorResponse(404, "Tiket tidak ditemukan.");
        return json(yield* (yield* Views).ticketTranscript(ticketId));
      }),
    ),
  ),

  route(
    "POST",
    "/api/tickets/:id/investigate",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* optionalBody(InvestigateRequest, {});
          const ticket = yield* (yield* Store).getTicket(yield* id);
          if (!ticket) return errorResponse(404, "Tiket tidak ditemukan.");
          const user = yield* CurrentUser;
          return sseResponse((yield* Agent).run({ kind: "ticket", ticket, question: input.question, askedBy: user.username }));
        }),
      ),
    ),
  ),

  route(
    "POST",
    "/api/ask",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(AskRequest);
          const user = yield* CurrentUser;
          return sseResponse(
            (yield* Agent).run({
              kind: "ask",
              question: input.question,
              conversationId: input.conversationId,
              askedBy: user.username,
            }),
          );
        }),
      ),
    ),
  ),

  route(
    "GET",
    "/api/conversations",
    authed(
      Effect.gen(function* () {
        const mine = (yield* searchParams).get("mine") === "1";
        const user = yield* CurrentUser;
        return json(yield* (yield* Views).conversations(mine ? user.username : undefined));
      }),
    ),
  ),

  route(
    "GET",
    "/api/conversations/:id",
    authed(
      Effect.gen(function* () {
        const transcript = yield* (yield* Views).conversation(yield* id);
        return transcript ? json(transcript) : errorResponse(404, "Percakapan tidak ditemukan.");
      }),
    ),
  ),

  route(
    "GET",
    "/api/patients/:rm",
    authed(
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const rm = yield* pathParam("rm");
        return yield* runTool(kartuPasien, { noRkmMedis: rm }, { sessionId: `ui:${user.username}` }).pipe(
          Effect.map((card) => (card.pasien ? json(card) : errorResponse(404, `Pasien dengan RM ${rm} tidak ditemukan.`))),
          Effect.catch((e) => Effect.succeed(errorResponse(e._tag === "ToolInputError" ? 400 : 502, e.message))),
        );
      }),
    ),
  ),
);

const FixRoutes = Layer.mergeAll(
  route(
    "GET",
    "/api/fixes",
    authed(
      handled(
        Effect.gen(function* () {
          const query = yield* searchParams;
          const status = query.get("status") ?? undefined;
          if (status !== undefined && !Schema.is(FixStatus)(status)) return yield* Effect.fail(`Status tidak dikenal: ${status}`);
          return json(yield* (yield* FixStore).list({ status, ticketId: query.get("ticketId") ?? undefined }));
        }),
      ),
    ),
  ),

  route(
    "POST",
    "/api/fixes",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(CreateFixRequest);
          const user = yield* CurrentUser;
          const store = yield* FixStore;
          const replaced = input.replaces ? yield* store.get(input.replaces) : undefined;
          if (input.replaces && replaced?.status !== "pending") {
            return yield* Effect.fail("Perbaikan yang diedit tidak ditemukan atau sudah diproses.");
          }
          const fix = yield* planFix(
            "POST /api/fixes",
            { title: input.title, reason: input.reason, sql: input.sql, params: input.params ?? [] },
            {
              runId: null,
              toolCallId: null,
              createdBy: user.username,
              ticketId: input.ticketId ?? replaced?.ticketId ?? null,
            },
          ).pipe(Effect.mapError((e) => e.message));
          if (replaced) {
            yield* (yield* FixExecutor)
              .reject(replaced.id, user.username, `Diganti dengan perbaikan hasil edit (${fix.id}).`)
              .pipe(Effect.ignore);
          }
          return json(fix, 201);
        }),
      ),
    ),
  ),

  route(
    "GET",
    "/api/fixes/:id",
    authed(
      Effect.gen(function* () {
        const store = yield* FixStore;
        const fixId = yield* id;
        const fix = yield* store.get(fixId);
        if (!fix) return errorResponse(404, "Perbaikan tidak ditemukan.");
        return json({ fix, events: yield* store.events(fixId) });
      }),
    ),
  ),

  route(
    "POST",
    "/api/fixes/:id/approve",
    authed(fixAction(Effect.gen(function* () {
      return yield* (yield* FixExecutor).approve(yield* id, (yield* CurrentUser).username);
    }))),
  ),

  route(
    "POST",
    "/api/fixes/:id/reject",
    authed(fixAction(Effect.gen(function* () {
      const input = yield* optionalBody(RejectFixRequest, {});
      return yield* (yield* FixExecutor).reject(yield* id, (yield* CurrentUser).username, input.reason);
    }))),
  ),

  route(
    "POST",
    "/api/fixes/:id/rollback",
    authed(fixAction(Effect.gen(function* () {
      return yield* (yield* FixExecutor).rollback(yield* id, (yield* CurrentUser).username);
    }))),
  ),
);

/** Documents are self-contained HTML: no scripts, nothing loaded from elsewhere, framed only by the app. */
const DOCUMENT_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  "x-frame-options": "SAMEORIGIN",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

const DocumentRoutes = Layer.mergeAll(
  route(
    "POST",
    "/api/documents",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(CreateDocumentRequest);
          const user = yield* CurrentUser;
          return yield* runTool(dokumenPasien, input, { sessionId: `ui:${user.username}`, actor: user.username }).pipe(
            Effect.map((out) => json(out.document, 201)),
            Effect.catch((e) =>
              Effect.succeed(
                errorResponse(e._tag === "ToolInputError" ? 400 : e._tag === "ToolError" ? 404 : 502, e.message),
              ),
            ),
          );
        }),
      ),
    ),
  ),

  route(
    "GET",
    "/api/documents/:id",
    authed(
      Effect.gen(function* () {
        const stored = yield* (yield* ResultStore).getDocument(yield* id);
        if (!stored) return errorResponse(404, "Dokumen tidak ditemukan.");
        const download = (yield* searchParams).get("download") === "1";
        if (download) {
          const user = yield* CurrentUser;
          yield* (yield* Auth).logEvent("document_downloaded", user.username, `${stored.info.judul}: ${stored.info.subjek}`);
        }
        const fileName = `${stored.info.jenis}-${stored.info.subjek.replaceAll(/[^A-Za-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")}.html`;
        return HttpServerResponse.text(stored.html, {
          contentType: "text/html; charset=utf-8",
          headers: { ...DOCUMENT_HEADERS, ...(download ? { "content-disposition": `attachment; filename="${fileName}"` } : {}) },
        });
      }),
    ),
  ),
);

const DataRoutes = Layer.mergeAll(
  route("GET", "/api/favorites", authed(Effect.gen(function* () {
      return json(yield* (yield* ResultStore).listFavorites);
    }))),

  route(
    "POST",
    "/api/favorites",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(CreateFavoriteRequest);
          const user = yield* CurrentUser;
          return yield* favoriteFromBlock(input.blockId, user.username, input.question).pipe(
            Effect.map((favorite) => json(favorite, 201)),
            Effect.catch((message: string) => Effect.succeed(errorResponse(404, message))),
          );
        }),
      ),
    ),
  ),

  route(
    "DELETE",
    "/api/favorites/:id",
    authed(
      Effect.gen(function* () {
        const deleted = yield* (yield* ResultStore).deleteFavorite(yield* id);
        return deleted ? HttpServerResponse.empty({ status: 204 }) : errorResponse(404, "Favorit tidak ditemukan.");
      }),
    ),
  ),

  route(
    "POST",
    "/api/favorites/:id/run",
    authed(
      Effect.gen(function* () {
        const favorite = yield* (yield* ResultStore).getFavorite(yield* id);
        if (!favorite) return errorResponse(404, "Favorit tidak ditemukan.");
        return yield* runFavorite(favorite).pipe(
          Effect.map((block) => json({ block })),
          Effect.catch((message: string) => Effect.succeed(errorResponse(422, message))),
        );
      }),
    ),
  ),

  route(
    "GET",
    "/api/settings/llm",
    authed(Effect.gen(function* () {
      return json(yield* (yield* LlmSettingsService).view);
    })),
  ),

  route(
    "PUT",
    "/api/settings/llm",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(UpdateLlmSettingsRequest);
          const user = yield* CurrentUser;
          const view = yield* (yield* LlmSettingsService).update(input, user);
          yield* (yield* Auth).logEvent("llm_settings_changed", user.username, `${view.provider} / ${view.model}`);
          return json(view);
        }),
      ),
      { admin: true },
    ),
  ),

  route(
    "POST",
    "/api/settings/llm/test",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(UpdateLlmSettingsRequest);
          return json(yield* (yield* LlmSettingsService).test(input));
        }),
      ),
      { admin: true },
    ),
  ),

  route(
    "GET",
    "/api/audit",
    authed(
      handled(
        Effect.gen(function* () {
          const query = yield* searchParams;
          const kind = query.get("kind") ?? "runs";
          if (!Schema.is(AuditKind)(kind)) return yield* Effect.fail(`Jenis audit tidak dikenal: ${kind}`);
          const date = (name: string) => {
            const value = query.get(name);
            return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
          };
          const number = (name: string, fallback: number, max: number) =>
            Math.min(max, Math.max(0, Number.parseInt(query.get(name) ?? "", 10) || fallback));
          return json(
            yield* (yield* Views).audit({
              kind,
              q: query.get("q")?.trim() || undefined,
              from: date("from"),
              to: date("to"),
              limit: number("limit", 50, 200),
              offset: number("offset", 0, 1_000_000),
            }),
          );
        }),
      ),
    ),
  ),
);

/** The web UI: every GET that is not an API route. */
const WebRoutes = route(
  "GET",
  "/*",
  Effect.gen(function* () {
    const { webDir } = yield* HttpSettings;
    return yield* serveWebApp(webDir);
  }),
);

export const Routes = Layer.mergeAll(AuthRoutes, TicketRoutes, FixRoutes, DocumentRoutes, DataRoutes, WebRoutes);

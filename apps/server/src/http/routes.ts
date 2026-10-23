/**
 * HTTP API under /api, plus the web UI at every other path. Request bodies are
 * checked against the Schemas in @simha/shared. Every route except health,
 * login and first-run setup needs a logged-in user (session cookie); the user
 * is who approves fixes and asks questions in the audit log.
 *
 *   GET    /api/health                   server, Khanza, AI model and PACS status (public)
 *   GET    /api/auth/state               logged-in user, or whether setup is needed (public)
 *   POST   /api/auth/setup               create the first admin (only while there are no users)
 *   POST   /api/auth/login | logout
 *   POST   /api/auth/password            change own password
 *   GET    /api/users                    list users (admin)
 *   POST   /api/users                    create a user (admin)
 *   PATCH  /api/users/:id                rename, change role, disable, reset password (admin)
 *   GET    /api/stats                    registrations today, inpatients, pending fixes
 *   POST   /api/ask                      a Tanya Data question or an investigation (SSE)
 *   GET    /api/conversations            recent Tanya Data threads (?mine=1)
 *   GET    /api/conversations/:id        one thread with its answers and blocks
 *   PATCH  /api/conversations/:id        { pinned?, archived? }: pin or archive (owner or admin)
 *   DELETE /api/conversations/:id        remove a thread and its messages (owner or admin)
 *   GET    /api/patients/:rm             patient card (kartuPasien tool)
 *   GET    /api/patients/:rm/radiologi   the patient's radiology studies in Orthanc PACS (?dari=&sampai=)
 *   GET    /api/pacs/instances/:id/:kind one image through the server: thumb (JPEG), preview (PNG), file (DICOM)
 *   GET    /api/berkas                  a digital patient file (?noRawat=&kode=&view=1|download=1)
 *   GET    /api/fixes                    list fixes (?status=pending)
 *   POST   /api/fixes                    propose a fix by hand, or edit an AI proposal (`replaces`)
 *   GET    /api/fixes/:id                fix with preview rows and history
 *   POST   /api/fixes/:id/approve        approve and run it (write user, one transaction)
 *   POST   /api/fixes/:id/reject         reject it
 *   POST   /api/fixes/:id/rollback       restore the rows it changed
 *   POST   /api/documents                make a patient document (riwayat, cppt, resume) without the AI
 *   GET    /api/documents/:id            the document's HTML (?download=1 to save it)
 *   GET    /api/drafts/:id               a form draft (resume medis) in its latest state
 *   PATCH  /api/drafts/:id               change fields of a draft (checked against Khanza's limits)
 *   GET    /api/favorites                saved questions
 *   POST   /api/favorites                save the question and SQL behind a chat result
 *   DELETE /api/favorites/:id            remove one
 *   POST   /api/favorites/:id/run        re-run it without the AI; returns a render block
 *   GET    /api/knowledge                what the AI learned (examples and notes)
 *   POST   /api/knowledge                add a staff note
 *   PATCH  /api/knowledge/:id            verify / deactivate / edit (admin)
 *   DELETE /api/knowledge/:id            remove one (admin)
 *   POST   /api/knowledge/feedback       👍 or 👎 a result or whole answer, with an optional correction
 *   GET    /api/settings/llm             AI provider settings (no API key)
 *   PUT    /api/settings/llm             change them (admin)
 *   POST   /api/settings/llm/test        try settings without saving (admin)
 *   GET    /api/audit                    audit log (?kind=runs|tools|queries|fixes|events&q=&from=&to=&limit=&offset=)
 */
import { LlmClient } from "@simha/llm";
import {
  AskRequest,
  AuditKind,
  ChangePasswordRequest,
  CreateDocumentRequest,
  CreateFavoriteRequest,
  CreateFixRequest,
  CreateKnowledgeRequest,
  CreateUserRequest,
  FixStatus,
  KnowledgeFeedbackRequest,
  LoginRequest,
  RejectFixRequest,
  SetupRequest,
  UpdateConversationRequest,
  UpdateDraftRequest,
  UpdateKnowledgeRequest,
  UpdateLlmSettingsRequest,
  UpdateUserRequest,
  formProblems,
  type User,
} from "@simha/shared";
import {
  Berkas,
  dokumenPasien,
  FixStore,
  IMAGE_KINDS,
  isImageKind,
  isOrthancId,
  kartuPasien,
  KhanzaRead,
  KnowledgeStore,
  Pacs,
  personalReason,
  planFix,
  ResultStore,
  runTool,
  type PacsError,
} from "@simha/tools";
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

/** Empty body allowed (e.g. POST /api/fixes/:id/reject with no reason). */
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
      const pacs = yield* Pacs;
      return json({ ok: true, khanza: { connected: true, readOnly: true, server: read.server }, llm: llm.info, pacs: pacs.configured });
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

const ChatRoutes = Layer.mergeAll(
  route("GET", "/api/stats", authed(Effect.gen(function* () {
      return json(yield* (yield* Views).stats);
    }))),

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
              question: input.question,
              mode: input.mode ?? "tanya",
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
    "PATCH",
    "/api/conversations/:id",
    authed(
      handled(
        Effect.gen(function* () {
          const conversationId = yield* id;
          const user = yield* CurrentUser;
          const store = yield* Store;
          const owner = yield* store.conversationOwner(conversationId);
          if (owner === undefined) return errorResponse(404, "Percakapan tidak ditemukan.");
          if (owner !== user.username && user.role !== "admin") {
            return errorResponse(403, "Percakapan ini milik pengguna lain.");
          }
          const input = yield* body(UpdateConversationRequest);
          if (input.pinned === undefined && input.archived === undefined) {
            return errorResponse(400, "Isi pinned atau archived.");
          }
          if (!(yield* store.setConversationFlags(conversationId, input))) {
            return errorResponse(404, "Percakapan tidak ditemukan.");
          }
          const action =
            input.archived !== undefined
              ? input.archived
                ? "conversation_archived"
                : "conversation_unarchived"
              : input.pinned
                ? "conversation_pinned"
                : "conversation_unpinned";
          yield* (yield* Auth).logEvent(action, user.username, conversationId);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
  ),

  route(
    "DELETE",
    "/api/conversations/:id",
    authed(
      handled(
        Effect.gen(function* () {
          const conversationId = yield* id;
          const user = yield* CurrentUser;
          const store = yield* Store;
          const owner = yield* store.conversationOwner(conversationId);
          if (owner === undefined) return errorResponse(404, "Percakapan tidak ditemukan.");
          if (owner !== user.username && user.role !== "admin") {
            return errorResponse(403, "Percakapan ini milik pengguna lain.");
          }
          if (!(yield* store.removeConversation(conversationId))) {
            return errorResponse(404, "Percakapan tidak ditemukan.");
          }
          yield* (yield* Auth).logEvent("conversation_deleted", user.username, conversationId);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
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

/**
 * Radiology images from Orthanc. The browser never sees Orthanc's address or
 * login; images are streamed through. Opening a patient's images and
 * downloading DICOM files are written to the audit log.
 */
const PacsRoutes = Layer.mergeAll(
  route(
    "GET",
    "/api/patients/:rm/radiologi",
    authed(
      Effect.gen(function* () {
        const pacs = yield* Pacs;
        if (!pacs.configured) return json({ configured: false, viewerBase: null, studies: [] });
        const rm = (yield* pathParam("rm")).trim();
        // * and ? are DICOM wildcards: they would match other patients.
        if (!/^[^*?\\]{1,20}$/.test(rm)) return errorResponse(400, "Nomor RM tidak valid.");
        const query = yield* searchParams;
        const date = (name: string) => {
          const value = query.get(name);
          return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
        };
        const user = yield* CurrentUser;
        const auth = yield* Auth;
        return yield* pacs.studies(rm, { from: date("dari"), to: date("sampai") }).pipe(
          Effect.tap((studies) => auth.logEvent("radiology_viewed", user.username, `RM ${rm}: ${studies.length} studi`)),
          Effect.map((studies) => json({ configured: true, viewerBase: pacs.viewerBase, studies })),
          Effect.catch((e: PacsError) => Effect.succeed(errorResponse(502, e.message))),
        );
      }),
    ),
  ),

  route(
    "GET",
    "/api/pacs/instances/:id/:kind",
    authed(
      Effect.gen(function* () {
        const instance = yield* id;
        const kind = yield* pathParam("kind");
        if (!isOrthancId(instance)) return errorResponse(400, "ID gambar tidak valid.");
        if (!isImageKind(kind)) return errorResponse(404, "Tidak ditemukan.");
        const pacs = yield* Pacs;
        if (kind === "file") {
          const user = yield* CurrentUser;
          yield* (yield* Auth).logEvent("dicom_downloaded", user.username, instance);
        }
        return yield* pacs.image(instance, kind).pipe(
          Effect.map((upstream) =>
            HttpServerResponse.fromWeb(
              new Response(upstream.body, {
                headers: {
                  "content-type": upstream.headers.get("content-type") ?? IMAGE_KINDS[kind].type,
                  // Orthanc instances never change; cache in this browser only, never in shared proxies.
                  "cache-control": "private, max-age=86400, immutable",
                  "x-content-type-options": "nosniff",
                  ...(kind === "file" ? { "content-disposition": `attachment; filename="${instance}.dcm"` } : {}),
                },
              }),
            ),
          ),
          Effect.catch((e: PacsError) => Effect.succeed(errorResponse(502, e.message))),
        );
      }),
    ),
  ),
);

/**
 * Digital patient files (berkas digital) from Khanza. The database keeps a
 * relative path; the server resolves it inside KHANZA_BERKAS_DIR and streams
 * the file. The browser never sees the folder or the path. Opening a PDF or
 * a full image is logged; loading thumbnails is not.
 */
const BerkasRoutes = route(
  "GET",
  "/api/berkas",
  authed(
    Effect.gen(function* () {
      const query = yield* searchParams;
      const noRawat = query.get("noRawat")?.trim() ?? "";
      const kode = query.get("kode")?.trim() ?? "";
      if (!/^[A-Za-z0-9/_.-]{1,17}$/.test(noRawat) || !/^[A-Za-z0-9._-]{1,10}$/.test(kode)) {
        return errorResponse(400, "Berkas tidak valid.");
      }
      const read = yield* KhanzaRead;
      const rows = yield* read
        .query<{ readonly lokasi_file: string; readonly nama: string | null }>(
          (sql) => sql`
            SELECT b.lokasi_file, m.nama
            FROM berkas_digital_perawatan b
            LEFT JOIN master_berkas_digital m ON m.kode = b.kode
            WHERE b.no_rawat = ${noRawat} AND b.kode = ${kode}
            LIMIT 1`,
        )
        .pipe(Effect.catch(() => Effect.succeed([])));
      const row = rows[0];
      if (!row) return errorResponse(404, "Berkas tidak ditemukan.");
      const berkas = yield* Berkas;
      const result = yield* berkas.read(row.lokasi_file).pipe(
        Effect.map((file) => ({ ok: true as const, file })),
        Effect.catch((e) => Effect.succeed({ ok: false as const, message: e.message })),
      );
      if (!result.ok) return errorResponse(404, result.message);
      const file = result.file;
      const download = query.get("download") === "1";
      const view = query.get("view") === "1";
      if (download || view) {
        const user = yield* CurrentUser;
        yield* (yield* Auth).logEvent(download ? "berkas_downloaded" : "berkas_viewed", user.username, `${noRawat}/${kode}: ${row.nama ?? "berkas"}`);
      }
      const safeName = file.namaFile.replaceAll(/[^A-Za-z0-9._-]+/g, "-") || "berkas";
      const inline = !download && file.jenis !== "lainnya";
      return HttpServerResponse.fromWeb(
        new Response(file.response.body, {
          headers: {
            "content-type": file.contentType,
            "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "cache-control": "private, max-age=3600",
          },
        }),
      );
    }),
  ),
);

/** Form drafts (resume medis): read and edited in the draft card; filled into Khanza by the desktop app. */
const DraftRoutes = Layer.mergeAll(
  route(
    "GET",
    "/api/drafts/:id",
    authed(
      Effect.gen(function* () {
        const draft = yield* (yield* ResultStore).getDraft(yield* id);
        return draft ? json(draft) : errorResponse(404, "Draf tidak ditemukan.");
      }),
    ),
  ),
  route(
    "PATCH",
    "/api/drafts/:id",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(UpdateDraftRequest);
          const store = yield* ResultStore;
          const draftId = yield* id;
          const current = yield* store.getDraft(draftId);
          if (!current) return errorResponse(404, "Draf tidak ditemukan.");
          const values = Object.fromEntries(Object.entries(input.fields).map(([k, v]) => [k, v.trim()]));
          const problems = formProblems(current.form, values);
          if (problems.length > 0) return errorResponse(400, problems.join(" "));
          const user = yield* CurrentUser;
          const draft = yield* store.updateDraft(draftId, values, "user", user.username);
          return draft ? json(draft) : errorResponse(404, "Draf tidak ditemukan.");
        }),
      ),
    ),
  ),
);

/**
 * What the AI learned: examples saved from results, notes from staff and the
 * AI, 👍/👎 feedback, and the admin review actions. All of it lives in the
 * audit DB; none of it can change Khanza.
 */
const KnowledgeRoutes = Layer.mergeAll(
  route(
    "GET",
    "/api/knowledge",
    authed(
      Effect.gen(function* () {
        return json(yield* (yield* KnowledgeStore).list);
      }),
    ),
  ),

  route(
    "POST",
    "/api/knowledge",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(CreateKnowledgeRequest);
          const reason = personalReason(input.text);
          if (reason !== null) {
            return yield* Effect.fail(`Catatan tidak disimpan karena ${reason}. Simpan aturan umum, bukan data satu pasien.`);
          }
          const user = yield* CurrentUser;
          const item = yield* (yield* KnowledgeStore).add({
            kind: "note",
            source: "staff",
            text: input.text,
            verified: false,
            createdBy: user.username,
          });
          yield* (yield* Auth).logEvent("knowledge_added", user.username, item.id);
          return json(item, 201);
        }),
      ),
    ),
  ),

  route(
    "POST",
    "/api/knowledge/feedback",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(KnowledgeFeedbackRequest);
          const knowledge = yield* KnowledgeStore;
          const user = yield* CurrentUser;
          const blockId = input.blockId;
          const runId = input.runId;
          if ((blockId === undefined) === (runId === undefined)) {
            return yield* Effect.fail("Sertakan blockId (untuk hasil tabel/grafik) atau runId (untuk jawaban teks).");
          }

          // A whole text answer: store the question + answer as a verified note,
          // or a correction when 👎. Used when there is no render block to rate.
          if (runId !== undefined) {
            const run = yield* (yield* Store).getRun(runId);
            if (!run) return errorResponse(404, "Jawaban yang dinilai tidak ditemukan.");
            const answer = run.final_text?.trim() ?? "";
            if (answer === "") return yield* Effect.fail("Jawaban ini belum selesai; coba lagi setelah selesai.");
            const reason = personalReason(run.question) ?? personalReason(answer);
            if (reason !== null) {
              return yield* Effect.fail(
                `Jawaban ini tidak disimpan sebagai pengetahuan karena ${reason}. Simpan aturan umum, bukan data satu pasien.`,
              );
            }
            const existing = yield* knowledge.forRun(runId);
            const comment = input.comment?.trim();

            if (input.rating === "up") {
              const text = `Pertanyaan: ${run.question}\nJawaban: ${answer}`.slice(0, 1_000);
              const item = existing
                ? yield* knowledge.update(existing.id, { text, verified: true, active: true, source: "feedback" })
                : yield* knowledge.add({
                    kind: "note",
                    source: "feedback",
                    text,
                    verified: true,
                    runId,
                    createdBy: user.username,
                  });
              yield* (yield* Auth).logEvent("knowledge_feedback", user.username, `👍 run ${runId}`);
              return json({ ok: true, knowledge: item ?? null });
            }

            if (comment !== undefined && comment !== "") {
              const commentReason = personalReason(comment);
              if (commentReason !== null) {
                return yield* Effect.fail(
                  `Koreksi tidak disimpan karena ${commentReason}. Tulis aturan umumnya, bukan nomor pasien.`,
                );
              }
            }
            if (existing) yield* knowledge.update(existing.id, { active: false });
            const note =
              comment === undefined || comment === ""
                ? null
                : yield* knowledge.add({
                    kind: "note",
                    source: "feedback",
                    text: comment,
                    verified: false,
                    runId,
                    createdBy: user.username,
                  });
            yield* (yield* Auth).logEvent("knowledge_feedback", user.username, `👎 run ${runId}`);
            return json({ ok: true, knowledge: note });
          }

          if (blockId === undefined) return yield* Effect.fail("Sertakan blockId atau runId.");
          const results = yield* ResultStore;
          const stored = yield* results.getBlock(blockId);
          if (!stored) return errorResponse(404, "Hasil yang dinilai tidak ditemukan.");
          const question = stored.question ?? stored.block.judul;

          if (input.rating === "up") {
            const reason = personalReason(question) ?? personalReason(stored.block.sql);
            if (reason !== null) {
              return yield* Effect.fail(
                `Contoh ini tidak disimpan sebagai pengetahuan karena ${reason}. Simpan aturan umum, bukan data satu pasien.`,
              );
            }
            const existing = yield* knowledge.forBlock(blockId);
            const item = existing
              ? yield* knowledge.update(existing.id, { verified: true, active: true, source: "feedback" })
              : yield* knowledge.add({
                  kind: "example",
                  source: "feedback",
                  text: question,
                  sql: stored.block.sql,
                  renderType: stored.block.tipe,
                  title: stored.block.judul,
                  verified: true,
                  blockId,
                  runId: stored.sessionId,
                  createdBy: user.username,
                });
            yield* (yield* Auth).logEvent("knowledge_feedback", user.username, `👍 ${blockId}`);
            return json({ ok: true, knowledge: item ?? null });
          }

          // 👎: stop using the automatic example, and keep a correction as a note.
          const comment = input.comment?.trim();
          if (comment !== undefined && comment !== "") {
            const reason = personalReason(comment);
            if (reason !== null) {
              return yield* Effect.fail(
                `Koreksi tidak disimpan karena ${reason}. Tulis aturan umumnya, bukan nomor pasien.`,
              );
            }
          }
          yield* knowledge.deactivateForBlock(blockId);
          const note =
            comment === undefined || comment === ""
              ? null
              : yield* knowledge.add({
                  kind: "note",
                  source: "feedback",
                  text: comment,
                  verified: false,
                  createdBy: user.username,
                });
          yield* (yield* Auth).logEvent("knowledge_feedback", user.username, `👎 ${blockId}`);
          return json({ ok: true, knowledge: note });
        }),
      ),
    ),
  ),

  route(
    "PATCH",
    "/api/knowledge/:id",
    authed(
      handled(
        Effect.gen(function* () {
          const input = yield* body(UpdateKnowledgeRequest);
          if (input.text !== undefined) {
            const reason = personalReason(input.text);
            if (reason !== null) {
              return yield* Effect.fail(`Catatan tidak disimpan karena ${reason}. Simpan aturan umum, bukan data satu pasien.`);
            }
          }
          const user = yield* CurrentUser;
          const item = yield* (yield* KnowledgeStore).update(yield* id, input);
          if (!item) return errorResponse(404, "Pengetahuan tidak ditemukan.");
          yield* (yield* Auth).logEvent("knowledge_updated", user.username, `${item.id}: ${input.verified === true ? "verified" : ""}${input.active === false ? " nonaktif" : ""}`.trim());
          return json(item);
        }),
      ),
      { admin: true },
    ),
  ),

  route(
    "DELETE",
    "/api/knowledge/:id",
    authed(
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const knowledgeId = yield* id;
        const deleted = yield* (yield* KnowledgeStore).remove(knowledgeId);
        if (!deleted) return errorResponse(404, "Pengetahuan tidak ditemukan.");
        yield* (yield* Auth).logEvent("knowledge_deleted", user.username, knowledgeId);
        return HttpServerResponse.empty({ status: 204 });
      }),
      { admin: true },
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

export const Routes = Layer.mergeAll(AuthRoutes, ChatRoutes, FixRoutes, DocumentRoutes, PacsRoutes, BerkasRoutes, DraftRoutes, DataRoutes, KnowledgeRoutes, WebRoutes);

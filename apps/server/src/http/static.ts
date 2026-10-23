/**
 * Serves the built web UI from WEB_DIST_DIR, with index.html for every
 * non-file path (client-side routes such as /tanya or /pengaturan). Files are read
 * from that folder only.
 */
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { readFile } from "node:fs/promises";
import * as NodePath from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/** Security headers for the UI pages. ECharts and Base UI set inline styles, scripts stay same-origin. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

const tryRead = (path: string) => Effect.promise(() => readFile(path).catch(() => undefined));

export const serveWebApp = (webDir: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
    if (pathname.startsWith("/api/") || pathname === "/api") {
      return HttpServerResponse.jsonUnsafe({ error: "Endpoint tidak ditemukan." }, { status: 404 });
    }
    const root = NodePath.resolve(webDir);
    const target = NodePath.resolve(root, `.${pathname}`);
    const inside = target === root || target.startsWith(root + NodePath.sep);
    const asset = inside && NodePath.extname(target) !== "" ? yield* tryRead(target) : undefined;
    if (asset) {
      const immutable = pathname.startsWith("/assets/");
      return HttpServerResponse.uint8Array(asset, {
        contentType: TYPES[NodePath.extname(target)] ?? "application/octet-stream",
        headers: {
          ...SECURITY_HEADERS,
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    }
    const index = yield* tryRead(NodePath.join(root, "index.html"));
    if (!index) {
      return HttpServerResponse.text(
        "Web UI belum dibangun. Jalankan `pnpm --filter @simha/web build`, atau `pnpm dev` untuk mode pengembangan.",
        { status: 404 },
      );
    }
    return HttpServerResponse.uint8Array(index, {
      contentType: TYPES[".html"],
      headers: { ...SECURITY_HEADERS, "cache-control": "no-cache" },
    });
  });

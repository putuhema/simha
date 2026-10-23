/**
 * Khanza's digital patient files (berkas digital): scans and photos stored by
 * Khanza outside the database. The database keeps the visit, the file kind and
 * a relative path; this service turns that path into a file Simha can serve.
 *
 * Two backends, in order:
 * - KHANZA_BERKAS_URL: base URL of Khanza's upload folder, e.g.
 *   `http://localhost:8080/webapps/berkasrawat/pages/upload/`. Files are
 *   fetched by the Simha server and streamed; the browser only sees /api/berkas.
 * - KHANZA_BERKAS_DIR: a local/mounted folder (usually `webapps/berkas`).
 *
 * The URL wins when both are set. Every path is checked against the base and
 * `..`, absolute paths, drives and other URLs are rejected. The AI and the
 * browser never see the configured folder or URL.
 */
import type { BerkasFileKind } from "@simha/shared";
import { Config, Context, Effect, Layer, Schema } from "effect";
import { readFile, realpath, stat } from "node:fs/promises";
import * as NodePath from "node:path";

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..", "..", "..");

const IMAGE_KINDS: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** Extension (lowercase, without dot) -> our kind. */
export const berkasKindOf = (fileName: string): BerkasFileKind => {
  const ext = NodePath.extname(fileName).slice(1).toLowerCase();
  if (ext === "pdf") return "pdf";
  return ext in IMAGE_KINDS ? "gambar" : "lainnya";
};

export const berkasContentType = (fileName: string): string => {
  const ext = NodePath.extname(fileName).slice(1).toLowerCase();
  if (ext === "pdf") return "application/pdf";
  return IMAGE_KINDS[ext] ?? "application/octet-stream";
};

/**
 * A Khanza `lokasi_file` -> a relative path inside the configured base.
 * Common prefixes are dropped (`webapps/`, `berkas/`, and the upload folder
 * used by berkasrawat); absolute paths, drive letters, URLs and `..` are
 * rejected. Null means "do not touch this row".
 */
export const safeRelativePath = (lokasi: string): string | null => {
  const raw = lokasi.trim();
  if (raw === "" || raw.includes("\0") || raw.length > 500) return null;
  // Absolute paths, UNC paths, drives and URLs are never valid Khanza rows.
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:/.test(raw) || /^[a-z]+:/i.test(raw)) return null;
  const clean = raw.replaceAll("\\", "/");
  const relative = clean.replace(/^(?:webapps\/)?(?:berkasrawat\/pages\/upload\/|pages\/upload\/|berkas\/)/i, "");
  if (relative === "" || NodePath.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || /^[a-z]+:/i.test(relative)) return null;
  const parts = relative.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return relative;
};

/**
 * Resolve a `lokasi_file` against the configured upload URL. Returns null
 * when the base or the path is not safe. The base never changes; only the
 * checked relative path is appended.
 */
export const berkasUrl = (base: string, lokasi: string): string | null => {
  const trimmed = base.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const root = new URL(parsed.href);
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  root.search = "";
  root.hash = "";
  const relative = safeRelativePath(lokasi);
  if (relative === null) return null;
  const url = new URL(relative, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
  return url.href;
};

/** A file that can be shown or downloaded. */
export interface BerkasInfo {
  readonly namaFile: string;
  readonly jenis: BerkasFileKind;
  /** Bytes, or null when the server does not send Content-Length. */
  readonly ukuran: number | null;
}

export interface BerkasContent extends BerkasInfo {
  /** The file body, ready to be streamed by the route. */
  readonly response: Response;
  readonly contentType: string;
}

export interface BerkasOptions {
  /** Local/mounted folder that holds the files. */
  readonly dir: string;
  /** Base URL of Khanza's upload folder. Takes precedence over `dir`. */
  readonly url?: string;
  /** Largest file served (bytes). */
  readonly maxBytes?: number;
}

export interface BerkasService {
  readonly configured: boolean;
  /** Metadata only; fails when the file is missing or outside the base. */
  readonly info: (lokasi: string) => Effect.Effect<BerkasInfo, BerkasError>;
  /** The body plus the response headers the route needs. */
  readonly read: (lokasi: string) => Effect.Effect<BerkasContent, BerkasError>;
}

export class BerkasError extends Schema.TaggedError<BerkasError>()("BerkasError", { message: Schema.String }) {}

export class Berkas extends Context.Service<Berkas, BerkasService>()("simha/Berkas") {}

const fail = (message: string) => Effect.fail(new BerkasError({ message }));

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 10_000;

const sizeOf = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const cancel = (response: Response) => Effect.promise(() => response.body?.cancel() ?? Promise.resolve());

const tooLarge = (namaFile: string, maxBytes: number) =>
  `Berkas ${namaFile} terlalu besar untuk ditampilkan (maks ${Math.round(maxBytes / 1024 / 1024)} MB).`;

export const makeBerkas = (options: BerkasOptions): BerkasService => {
  const baseUrl = options.url?.trim() ?? "";
  const dir = options.dir.trim() === "" ? null : NodePath.resolve(repoRoot, options.dir.trim());
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const useUrl = baseUrl !== "";
  const configured = useUrl || dir !== null;

  /** Local file metadata and path. */
  const resolveLocal = (lokasi: string) =>
    Effect.gen(function* () {
      if (dir === null) return yield* fail("Folder berkas digital belum diatur di server (KHANZA_BERKAS_DIR).");
      const relative = safeRelativePath(lokasi);
      if (relative === null) return yield* fail("Lokasi berkas di database tidak valid.");
      const namaFile = NodePath.basename(relative);
      const jenis = berkasKindOf(namaFile);
      const resolved = yield* Effect.tryPromise({
        try: async () => {
          const root = await realpath(dir);
          const rootStat = await stat(root);
          if (!rootStat.isDirectory()) throw new Error("bukan folder");
          const absolute = NodePath.resolve(root, relative);
          if (!absolute.startsWith(root + NodePath.sep)) throw new Error("di luar folder");
          const real = await realpath(absolute);
          if (!real.startsWith(root + NodePath.sep)) throw new Error("di luar folder");
          const fileStat = await stat(real);
          if (!fileStat.isFile()) throw new Error("bukan file");
          if (fileStat.size > maxBytes) throw new Error("terlalu besar");
          return { path: real, size: fileStat.size };
        },
        catch: (cause) => {
          const reason = cause instanceof Error ? cause.message : String(cause);
          return new BerkasError({
            message:
              reason === "terlalu besar"
                ? tooLarge(namaFile, maxBytes)
                : reason === "bukan folder"
                  ? "Folder berkas digital di server bukan sebuah folder."
                  : reason === "di luar folder"
                    ? "Lokasi berkas di database menunjuk ke luar folder berkas digital."
                    : "Berkas tidak ditemukan di server.",
          });
        },
      });
      return { path: resolved.path, namaFile, jenis, ukuran: resolved.size };
    });

  /** URL metadata for the configured upload folder. */
  const resolveUrl = (lokasi: string, namaFile: string, jenis: BerkasFileKind) =>
    Effect.gen(function* () {
      const target = berkasUrl(baseUrl, lokasi);
      if (target === null) return yield* fail("Alamat berkas digital di server tidak valid (KHANZA_BERKAS_URL).");
      const info = yield* Effect.tryPromise({
        try: async () => {
          const head = await fetch(target, { method: "HEAD", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
          if (head.ok) return { size: sizeOf(head.headers.get("content-length")) };
          if (head.status !== 405 && head.status !== 501) {
            throw new Error(head.status === 404 ? "notfound" : `http ${head.status}`);
          }
          // Some Khanza web servers do not allow HEAD; a one-byte range GET is enough to check.
          const response = await fetch(target, {
            headers: { range: "bytes=0-0" },
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
          });
          await response.body?.cancel();
          if (!response.ok && response.status !== 206) throw new Error(response.status === 404 ? "notfound" : `http ${response.status}`);
          return { size: null };
        },
        catch: (cause) => {
          const reason = cause instanceof Error ? cause.message : String(cause);
          return new BerkasError({
            message:
              reason === "notfound"
                ? "Berkas tidak ditemukan di server."
                : reason === "http 401" || reason === "http 403"
                  ? `Server berkas Khanza menolak akses (HTTP ${reason.slice(5)}).`
                  : "Server berkas digital tidak bisa dihubungi.",
          });
        },
      });
      return { url: target, namaFile, jenis, ukuran: info.size };
    });

  const resolve = (lokasi: string) =>
    Effect.gen(function* () {
      const relative = safeRelativePath(lokasi);
      if (relative === null) return yield* fail("Lokasi berkas di database tidak valid.");
      const namaFile = NodePath.basename(relative);
      const jenis = berkasKindOf(namaFile);
      if (useUrl) return yield* resolveUrl(lokasi, namaFile, jenis);
      return yield* resolveLocal(lokasi);
    });

  return {
    configured,
    info: (lokasi) =>
      Effect.map(resolve(lokasi), ({ namaFile, jenis, ukuran }) => ({ namaFile, jenis, ukuran })),
    read: (lokasi) =>
      Effect.gen(function* () {
        const relative = safeRelativePath(lokasi);
        if (relative === null) return yield* fail("Lokasi berkas di database tidak valid.");
        const namaFile = NodePath.basename(relative);
        const jenis = berkasKindOf(namaFile);
        const contentType = berkasContentType(namaFile);

        if (useUrl) {
          const target = berkasUrl(baseUrl, lokasi);
          if (target === null) return yield* fail("Alamat berkas digital di server tidak valid (KHANZA_BERKAS_URL).");
          const response = yield* Effect.tryPromise({
            try: () => fetch(target, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
            catch: () => new BerkasError({ message: "Server berkas digital tidak bisa dihubungi." }),
          });
          if (!response.ok) {
            yield* cancel(response);
            return yield* fail(
              response.status === 404
                ? "Berkas tidak ditemukan di server."
                : response.status === 401 || response.status === 403
                  ? `Server berkas Khanza menolak akses (HTTP ${response.status}).`
                  : `Server berkas digital menolak permintaan (HTTP ${response.status}).`,
            );
          }
          const ukuran = sizeOf(response.headers.get("content-length"));
          if (ukuran !== null && ukuran > maxBytes) {
            yield* cancel(response);
            return yield* fail(tooLarge(namaFile, maxBytes));
          }
          return { response, namaFile, jenis, ukuran, contentType };
        }

        const resolved = yield* resolveLocal(lokasi);
        const data = yield* Effect.tryPromise({
          try: () => readFile(resolved.path),
          catch: () => new BerkasError({ message: "Berkas tidak bisa dibaca dari server." }),
        });
        return {
          response: new Response(data, { headers: { "content-type": contentType } }),
          namaFile,
          jenis,
          ukuran: resolved.ukuran,
          contentType,
        };
      }),
  };
};

const BerkasConfig = Config.all({
  dir: Config.String("KHANZA_BERKAS_DIR").pipe(Config.withDefault("")),
  url: Config.String("KHANZA_BERKAS_URL").pipe(Config.withDefault("")),
  maxBytes: Config.Number("KHANZA_BERKAS_MAX_BYTES").pipe(Config.withDefault(DEFAULT_MAX_BYTES)),
});

export const BerkasLive = Layer.effect(
  Berkas,
  Effect.map(BerkasConfig, (options) => makeBerkas(options)),
);

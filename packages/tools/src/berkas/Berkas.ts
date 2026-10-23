/**
 * Khanza's digital patient files (berkas digital): scans and photos stored on
 * the Khanza server, outside the database. The database only keeps the visit,
 * the file kind and a relative path; this service turns that path into a file
 * the Simha server can safely read.
 *
 * Set KHANZA_BERKAS_DIR to the folder that holds Khanza's files (usually
 * `webapps/berkas`). A relative path is resolved from the repository root. All
 * paths are checked against that folder, so a bad database row cannot read
 * anything outside it. Files are read into memory with a size limit and served
 * through an authenticated route; the browser never sees the folder.
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
 * A Khanza `lokasi_file` -> a relative path inside the configured folder.
 * Common prefixes are dropped; absolute paths, drive letters, URLs and `..`
 * are rejected. Null means "do not touch this row".
 */
export const safeRelativePath = (lokasi: string): string | null => {
  const raw = lokasi.trim();
  if (raw === "" || raw.includes("\0") || raw.length > 500) return null;
  // Absolute paths, UNC paths, drives and URLs are never valid Khanza rows.
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:/.test(raw) || /^[a-z]+:/i.test(raw)) return null;
  const clean = raw.replaceAll("\\", "/");
  const relative = clean.replace(/^(?:webapps\/)?berkas\//i, "");
  if (relative === "" || NodePath.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || /^[a-z]+:/i.test(relative)) return null;
  const parts = relative.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return relative;
};

/** A file that can be shown or downloaded. */
export interface BerkasInfo {
  readonly namaFile: string;
  readonly jenis: BerkasFileKind;
  readonly ukuran: number;
}

export interface BerkasContent extends BerkasInfo {
  readonly data: Uint8Array;
  readonly contentType: string;
}

export interface BerkasOptions {
  /** Folder that holds the files. Empty = listing works, opening does not. */
  readonly dir: string;
  /** Largest file served (bytes). */
  readonly maxBytes?: number;
}

export interface BerkasService {
  readonly configured: boolean;
  /** Metadata only; fails when the file is missing or outside the folder. */
  readonly info: (lokasi: string) => Effect.Effect<BerkasInfo, BerkasError>;
  /** The bytes plus the response headers the route needs. */
  readonly read: (lokasi: string) => Effect.Effect<BerkasContent, BerkasError>;
}

export class BerkasError extends Schema.TaggedError<BerkasError>()("BerkasError", { message: Schema.String }) {}

export class Berkas extends Context.Service<Berkas, BerkasService>()("simha/Berkas") {}


const error = (message: string) => Effect.fail(new BerkasError({ message }));

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export const makeBerkas = (options: BerkasOptions): BerkasService => {
  const dir = options.dir.trim() === "" ? null : NodePath.resolve(repoRoot, options.dir.trim());
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const resolve = (lokasi: string) =>
    Effect.gen(function* () {
      if (dir === null) {
        return yield* error("Folder berkas digital belum diatur di server (KHANZA_BERKAS_DIR).");
      }
      const relative = safeRelativePath(lokasi);
      if (relative === null) return yield* error("Lokasi berkas di database tidak valid.");
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
                ? `Berkas ${namaFile} terlalu besar untuk ditampilkan (maks ${Math.round(maxBytes / 1024 / 1024)} MB).`
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

  return {
    configured: dir !== null,
    info: (lokasi) => Effect.map(resolve(lokasi), ({ namaFile, jenis, ukuran }) => ({ namaFile, jenis, ukuran })),
    read: (lokasi) =>
      Effect.flatMap(resolve(lokasi), ({ path, namaFile, jenis, ukuran }) =>
        Effect.map(
          Effect.tryPromise({
            try: () => readFile(path),
            catch: () => new BerkasError({ message: "Berkas tidak bisa dibaca dari server." }),
          }),
          (data) => ({ data, namaFile, jenis, ukuran, contentType: berkasContentType(namaFile) }),
        ),
      ),
  };
};

const BerkasConfig = Config.all({
  dir: Config.String("KHANZA_BERKAS_DIR").pipe(Config.withDefault("")),
  maxBytes: Config.Number("KHANZA_BERKAS_MAX_BYTES").pipe(Config.withDefault(DEFAULT_MAX_BYTES)),
});

export const BerkasLive = Layer.effect(
  Berkas,
  Effect.map(BerkasConfig, (options) => makeBerkas(options)),
);


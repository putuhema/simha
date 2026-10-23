/**
 * Read-only client for the Orthanc PACS, where radiology images live.
 * Patients are matched by No. RM = DICOM PatientID (the same rule Khanza's
 * own Orthanc form uses). The address and login stay on the server: the
 * browser only sees our /api/pacs routes, which stream images through.
 */
import type { PacsSeries, PacsStudy } from "@simrs/shared";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";

const PacsConfig = Config.all({
  /** Base URL with port, e.g. http://192.168.1.20:8042. Empty = no PACS (radiology images hidden). */
  url: Config.String("ORTHANC_URL").pipe(
    Config.withDefault(""),
    Config.map((url) => url.trim().replace(/\/+$/, "")),
  ),
  user: Config.String("ORTHANC_USER").pipe(Config.withDefault("")),
  pass: Config.Redacted("ORTHANC_PASS").pipe(Config.withDefault(Redacted.make(""))),
});
export type PacsOptions = Config.Success<typeof PacsConfig>;

/** Orthanc could not be reached or refused. The message is shown to the user. */
export class PacsError extends Schema.TaggedError<PacsError>()("PacsError", { message: Schema.String }) {}

/** What the image proxy can fetch for one instance. */
export const IMAGE_KINDS = {
  /** Small JPEG rendered by Orthanc, for thumbnails. */
  thumb: { path: "rendered?height=320&quality=80", accept: "image/jpeg", type: "image/jpeg" },
  /** Full-size PNG, for the viewer. */
  preview: { path: "preview", accept: "image/png", type: "image/png" },
  /** The original DICOM file. */
  file: { path: "file", accept: "application/dicom", type: "application/dicom" },
} as const;
export type ImageKind = keyof typeof IMAGE_KINDS;
export const isImageKind = (kind: string): kind is ImageKind => Object.hasOwn(IMAGE_KINDS, kind);

/** Orthanc IDs are SHA-1 based: five dash-separated groups of 8 hex digits. */
export const isOrthancId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{8}){4}$/.test(id);

/** Most studies listed for one patient (newest first). */
const MAX_STUDIES = 50;

export interface PacsService {
  readonly configured: boolean;
  /** Orthanc's base URL, for links to its Stone Web Viewer. Null when not configured. */
  readonly viewerBase: string | null;
  /** The patient's studies with their series, newest first. Dates are YYYY-MM-DD. */
  readonly studies: (noRm: string, range?: { readonly from?: string | undefined; readonly to?: string | undefined }) => Effect.Effect<ReadonlyArray<PacsStudy>, PacsError>;
  /** One image or DICOM file, as Orthanc's response (body not read yet). */
  readonly image: (instanceId: string, kind: ImageKind) => Effect.Effect<Response, PacsError>;
}

export class Pacs extends Context.Service<Pacs, PacsService>()("simrs/Pacs") {}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const dicomDate = (d: string) => d.replaceAll("-", "");
const isoDate = (d: unknown) => (typeof d === "string" && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "");
const hhmm = (t: unknown) => (typeof t === "string" && t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : "");
const tag = (tags: Record<string, unknown> | undefined, name: string) => {
  const value = tags?.[name];
  return typeof value === "string" ? value.trim() : "";
};

interface OrthancResource {
  readonly ID: string;
  readonly MainDicomTags?: Record<string, unknown>;
  readonly Instances?: ReadonlyArray<string>;
}

const makePacs = (options: PacsOptions, fetchImpl: Fetch = fetch): PacsService => {
  const { url, user } = options;
  const pass = Redacted.value(options.pass);
  const auth = user ? `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` : null;

  const call = (path: string, init: RequestInit & { readonly timeoutMs?: number } = {}) =>
    Effect.tryPromise({
      try: async (signal) => {
        const headers = new Headers(init.headers);
        if (auth) headers.set("authorization", auth);
        const response = await fetchImpl(`${url}${path}`, {
          ...init,
          headers,
          signal: AbortSignal.any([signal, AbortSignal.timeout(init.timeoutMs ?? 15_000)]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        return response;
      },
      catch: (e) => {
        const reason = e instanceof Error ? e.message : String(e);
        return new PacsError({
          message:
            reason === "HTTP 401" || reason === "HTTP 403"
              ? "PACS (Orthanc) menolak login. Periksa ORTHANC_USER dan ORTHANC_PASS."
              : `PACS (Orthanc) tidak dapat dihubungi (${reason}).`,
        });
      },
    });

  const json = <A>(path: string, init?: RequestInit) =>
    call(path, init).pipe(
      Effect.flatMap((r) => Effect.tryPromise({ try: () => r.json() as Promise<A>, catch: () => new PacsError({ message: "Jawaban PACS bukan JSON." }) })),
    );

  const notConfigured = Effect.fail(new PacsError({ message: "PACS belum diatur (ORTHANC_URL kosong)." }));

  return {
    configured: url !== "",
    viewerBase: url || null,

    studies: (noRm, range = {}) =>
      url === ""
        ? notConfigured
        : Effect.gen(function* () {
            const query: Record<string, string> = { PatientID: noRm };
            if (range.from || range.to) query["StudyDate"] = `${dicomDate(range.from ?? "")}-${dicomDate(range.to ?? "")}`;
            const found = yield* json<ReadonlyArray<OrthancResource>>("/tools/find", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ Level: "Study", Expand: true, Limit: MAX_STUDIES, Query: query }),
            });
            const studies = yield* Effect.forEach(
              found,
              (s) =>
                Effect.gen(function* () {
                  // One request returns every series of the study with its instances.
                  const series = yield* json<ReadonlyArray<OrthancResource>>(`/studies/${s.ID}/series`);
                  const t = s.MainDicomTags;
                  return {
                    id: s.ID,
                    studyInstanceUid: tag(t, "StudyInstanceUID"),
                    date: isoDate(t?.["StudyDate"]),
                    time: hhmm(t?.["StudyTime"]),
                    description: tag(t, "StudyDescription"),
                    accession: tag(t, "AccessionNumber"),
                    institution: tag(t, "InstitutionName"),
                    series: series
                      .map(
                        (se): PacsSeries => ({
                          id: se.ID,
                          modality: tag(se.MainDicomTags, "Modality"),
                          description: tag(se.MainDicomTags, "SeriesDescription"),
                          bodyPart: tag(se.MainDicomTags, "BodyPartExamined"),
                          number: Number(tag(se.MainDicomTags, "SeriesNumber")) || 0,
                          instances: se.Instances ?? [],
                        }),
                      )
                      .toSorted((a, b) => a.number - b.number),
                  } satisfies PacsStudy;
                }),
              { concurrency: 4 },
            );
            return studies.toSorted((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
          }),

    image: (instanceId, kind) =>
      url === ""
        ? notConfigured
        : call(`/instances/${instanceId}/${IMAGE_KINDS[kind].path}`, {
            headers: { accept: IMAGE_KINDS[kind].accept },
            timeoutMs: 60_000,
          }),
  };
};

export const pacsLayer = (options: PacsOptions, fetchImpl?: Fetch) => Layer.succeed(Pacs, makePacs(options, fetchImpl));

export const PacsLive = Layer.effect(Pacs, Effect.map(PacsConfig, (options) => makePacs(options)));

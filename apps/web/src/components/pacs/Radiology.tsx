/**
 * Radiology images from the hospital's Orthanc PACS: a button on the patient
 * card opens the patient's studies (newest first) with a thumbnail per
 * series; a thumbnail opens a full-screen viewer that flicks through every
 * image of the study. Images come through the harness server
 * (/api/pacs/instances/...), which logs who opened them. The same study list
 * is shown in the chat, next to Khanza's readings, when the AI calls
 * `hasilRadiologi` (RadiologyCard).
 */
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { PacsStudies, PacsStudy, RadiologyExam, RadiologyGallery } from "@simha/shared";
import { ChevronLeft, ChevronRight, Download, ExternalLink, ScanLine, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { useApi } from "../../lib/useApi.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { ErrorText } from "../ui/Field.tsx";
import { Empty, Spinner } from "../ui/Spinner.tsx";
import { useAuth } from "../../stores/auth.ts";

const image = (instance: string, kind: "thumb" | "preview" | "file") => `/api/pacs/instances/${instance}/${kind}`;

const dateLabel = (study: PacsStudy) => {
  if (!study.date) return "Tanpa tanggal";
  const date = new Date(`${study.date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return study.time ? `${date} · ${study.time}` : date;
};

const stoneUrl = (viewerBase: string | null, study: PacsStudy | undefined) =>
  viewerBase && study?.studyInstanceUid
    ? `${viewerBase}/stone-webviewer/index.html?study=${encodeURIComponent(study.studyInstanceUid)}`
    : null;

interface ViewerImage {
  readonly instance: string;
  readonly caption: string;
}

/** Every image of a study in series order, with a caption per image. */
const imagesOf = (study: PacsStudy): ReadonlyArray<ViewerImage> =>
  study.series.flatMap((se) =>
    se.instances.map((instance, i) => ({
      instance,
      caption: [
        `Seri ${se.number}`,
        se.description || se.bodyPart,
        se.modality,
        se.instances.length > 1 ? `gambar ${i + 1}/${se.instances.length}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  );

/** Full-screen image viewer. ← → flick through the images, Esc closes. */
const Viewer = ({
  study,
  start,
  viewerBase,
  onClose,
}: {
  readonly study: PacsStudy | null;
  readonly start: number;
  readonly viewerBase: string | null;
  readonly onClose: () => void;
}) => {
  const images = study ? imagesOf(study) : [];
  const [index, setIndex] = useState(start);
  useEffect(() => setIndex(start), [start, study]);
  const current = images[index];
  const go = (delta: number) => images.length > 0 && setIndex((i) => (i + delta + images.length) % images.length);
  const count = images.length;
  // On the window: focus may still be on the thumbnail that opened the viewer.
  useEffect(() => {
    if (study === null || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (delta === 0) return;
      e.preventDefault();
      setIndex((i) => (i + delta + count) % count);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [study, count]);
  const stone = stoneUrl(viewerBase, study ?? undefined);

  return (
    <BaseDialog.Root open={study !== null} onOpenChange={(open) => !open && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Popup
          className="fixed inset-0 z-50 flex flex-col bg-[#0b0f0f] text-white outline-none transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
          data-testid="pacs-viewer"
        >
          <header className="flex h-12 shrink-0 items-center gap-3 px-4 text-[13px]">
            <BaseDialog.Title className="truncate text-white/85">
              {study ? `${study.description || "Studi radiologi"} · ${dateLabel(study)}` : ""}
            </BaseDialog.Title>
            <span className="truncate text-white/55">{current?.caption}</span>
            <span className="font-mono text-[12px] text-white/50">
              {images.length > 0 ? `${index + 1} / ${images.length}` : ""}
            </span>
            <span className="ml-auto" />
            {stone ? (
              <a className="viewer-btn" href={stone} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> Stone Viewer
              </a>
            ) : null}
            {current ? (
              <a className="viewer-btn" href={image(current.instance, "file")} download>
                <Download className="size-3.5" /> Unduh DICOM
              </a>
            ) : null}
            <BaseDialog.Close className="viewer-btn" aria-label="Tutup">
              <X className="size-4" /> <span className="font-mono text-[11px] text-white/50">Esc</span>
            </BaseDialog.Close>
          </header>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-6">
            {current ? (
              <img
                key={current.instance}
                src={image(current.instance, "preview")}
                alt={current.caption}
                className="max-h-full max-w-full object-contain select-none"
                draggable={false}
              />
            ) : null}
            {images.length > 1 ? (
              <>
                <button type="button" className="viewer-nav left-3" onClick={() => go(-1)} aria-label="Gambar sebelumnya">
                  <ChevronLeft className="size-5" />
                </button>
                <button type="button" className="viewer-nav right-3" onClick={() => go(1)} aria-label="Gambar berikutnya">
                  <ChevronRight className="size-5" />
                </button>
              </>
            ) : null}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
};

/** One thumbnail per series; a click opens the viewer at that series' first image. */
const StudyThumbs = ({
  study,
  onOpen,
  className,
}: {
  readonly study: PacsStudy;
  readonly onOpen: (index: number) => void;
  readonly className?: string;
}) => {
  // Index of each series' first image in the viewer's flat list.
  const firstIndex = study.series.map((_, i) => study.series.slice(0, i).reduce((n, s) => n + s.instances.length, 0));
  return (
    <ul className={cn("grid grid-cols-3 gap-3 sm:grid-cols-5", className)}>
      {study.series.map((se, i) => (
        <li key={se.id}>
          <button
            type="button"
            className="group w-full text-left disabled:opacity-50"
            disabled={se.instances.length === 0}
            onClick={() => onOpen(firstIndex[i] ?? 0)}
          >
            <span className="relative block aspect-square overflow-hidden rounded-md bg-[#0b0f0f] ring-teal transition-shadow group-hover:ring-2">
              {se.instances[0] ? (
                <img
                  src={image(se.instances[0], "thumb")}
                  alt={`Seri ${se.number} ${se.description}`}
                  loading="lazy"
                  className="size-full object-contain"
                />
              ) : null}
              {se.instances.length > 1 ? (
                <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 font-mono text-[11px] text-white">
                  {se.instances.length}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block truncate text-[12px] text-ink-2">
              Seri {se.number} · {se.description || se.bodyPart || se.modality || "–"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};

const StudyBlock = ({
  study,
  viewerBase,
  onOpen,
}: {
  readonly study: PacsStudy;
  readonly viewerBase: string | null;
  readonly onOpen: (index: number) => void;
}) => {
  const imageCount = study.series.reduce((n, s) => n + s.instances.length, 0);
  const stone = stoneUrl(viewerBase, study);
  return (
    <section className="rounded-lg border border-line bg-card" data-testid="pacs-study">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line-2 px-4 py-2.5">
        <h3 className="font-display text-[15px] font-semibold">{study.description || "Studi radiologi"}</h3>
        <span className="font-mono text-[12px] text-ink-2">{dateLabel(study)}</span>
        <span className="text-[12px] text-ink-3">
          {[...new Set(study.series.map((s) => s.modality).filter(Boolean))].join(", ")}
          {study.accession ? ` · Acc ${study.accession}` : ""} · {study.series.length} seri · {imageCount} gambar
        </span>
        {stone ? (
          <a className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-teal hover:underline" href={stone} target="_blank" rel="noreferrer">
            Stone Viewer <ExternalLink className="size-3" />
          </a>
        ) : null}
      </header>
      <StudyThumbs study={study} onOpen={onOpen} className="p-3" />
    </section>
  );
};

/** The patient's studies; `open` controls the dialog. */
const RadiologyDialog = ({ rm, open, onOpenChange }: { readonly rm: string; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) => {
  const result = useApi<PacsStudies>(open ? `/api/patients/${encodeURIComponent(rm)}/radiologi` : null);
  const studies = result.data?.studies ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Gambar radiologi" description={`RM ${rm} · dari PACS (Orthanc)`}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto" data-testid="pacs-studies">
        {result.loading && !result.data ? (
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <Spinner className="size-4" /> Mengambil studi dari PACS…
          </div>
        ) : result.error ? (
          <ErrorText>{result.error}</ErrorText>
        ) : result.data && !result.data.configured ? (
          <Empty title="PACS belum diatur">Isi ORTHANC_URL di file .env server untuk menampilkan gambar radiologi.</Empty>
        ) : studies.length === 0 ? (
          <Empty title="Belum ada gambar">
            Tidak ada studi DICOM untuk RM {rm} di PACS. Pemeriksaan USG sering tidak dikirim ke PACS.
          </Empty>
        ) : (
          <StudyList studies={studies} viewerBase={result.data?.viewerBase ?? null} />
        )}
      </div>
    </Dialog>
  );
};

/** Study blocks with thumbnails; a thumbnail opens the viewer. */
const StudyList = ({ studies, viewerBase }: { readonly studies: ReadonlyArray<PacsStudy>; readonly viewerBase: string | null }) => {
  const [viewing, setViewing] = useState<{ readonly study: PacsStudy; readonly index: number } | null>(null);
  return (
    <>
      {studies.map((study) => (
        <StudyBlock key={study.id} study={study} viewerBase={viewerBase} onOpen={(index) => setViewing({ study, index })} />
      ))}
      <Viewer study={viewing?.study ?? null} start={viewing?.index ?? 0} viewerBase={viewerBase} onClose={() => setViewing(null)} />
    </>
  );
};

/** The reading, with the radiologist's conclusion ("Kesan") set apart when there is one. */
const Reading = ({ text }: { readonly text: string }) => {
  const match = /\bkesan\s*:/i.exec(text);
  const body = (match ? text.slice(0, match.index) : text).trim();
  const kesan = match ? text.slice(match.index + match[0].length).trim() : null;
  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {body ? <p className="whitespace-pre-wrap text-ink-2">{body}</p> : null}
      {kesan ? (
        <p className="rounded-md bg-teal-soft/60 px-3 py-2 whitespace-pre-wrap text-ink">
          <span className="font-semibold">Kesan: </span>
          {kesan}
        </p>
      ) : null}
    </div>
  );
};

/** Minutes since epoch for a date and HH:MM (00:00 when no time). */
const minutes = (date: string, time: string) => Date.parse(`${date}T${/^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "00:00"}:00Z`) / 60_000;

/**
 * PACS studies matched to the Khanza exam they belong to: an exam on the same
 * day or the day before (night exams), the closest in time. Studies left over
 * are shown on their own.
 */
const matchStudies = (exams: ReadonlyArray<RadiologyExam>, studies: ReadonlyArray<PacsStudy>) => {
  const byExam = new Map<RadiologyExam, Array<PacsStudy>>();
  const rest: Array<PacsStudy> = [];
  for (const study of studies) {
    const at = minutes(study.date, study.time);
    const exam = study.date
      ? exams
          .filter((e) => e.tanggal === study.date || (e.tanggal !== "" && day(e.tanggal, 1) === study.date))
          .toSorted((x, y) => Math.abs(minutes(x.tanggal, x.jam) - at) - Math.abs(minutes(y.tanggal, y.jam) - at))[0]
      : undefined;
    if (exam) byExam.set(exam, [...(byExam.get(exam) ?? []), study]);
    else rest.push(study);
  }
  return { byExam, rest };
};

const dayLabel = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "Tanpa tanggal";
/** YYYY-MM-DD plus `add` days. */
const day = (iso: string, add: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
};

/**
 * Radiology in the chat (from the AI's `hasilRadiologi` tool): each Khanza
 * exam with its reading and the PACS images of that exam, in one card.
 */
export const RadiologyCard = ({ gallery, flat = false }: { readonly gallery: RadiologyGallery; readonly flat?: boolean | undefined }) => {
  const allowed = useAuth((s) => s.user?.permissions.radiology === true);
  const [viewing, setViewing] = useState<{ readonly study: PacsStudy; readonly index: number } | null>(null);
  if (!allowed) {
    return (
      <figure className={cn("animate-rise @container overflow-hidden", !flat && "rounded-xl border border-line bg-card")} data-testid="radiology-card">
        <figcaption className="flex items-center gap-2.5 border-b border-line-2 px-3.5 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-paper-2 text-ink-3">
            <ScanLine className="size-4" />
          </span>
          <h3 className="font-display text-[14.5px] leading-tight font-semibold">Hasil radiologi</h3>
        </figcaption>
        <p className="px-3.5 py-3.5 text-[12.5px] text-ink-2">
          Akun SIMRS Anda tidak punya hak <span className="font-mono">periksa_radiologi</span>, jadi hasil radiologi ini
          tidak ditampilkan.
        </p>
      </figure>
    );
  }
  const { byExam, rest } = matchStudies(gallery.pemeriksaan, gallery.studies);
  const open = (study: PacsStudy) => (index: number) => setViewing({ study, index });
  const empty = gallery.pemeriksaan.length === 0 && gallery.studies.length === 0;
  return (
    <figure className={cn("animate-rise @container overflow-hidden", !flat && "rounded-xl border border-line bg-card")} data-testid="radiology-card">
      <figcaption className="flex items-center gap-2.5 border-b border-line-2 px-3.5 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-soft text-teal">
          <ScanLine className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-[14.5px] leading-tight font-semibold">Hasil radiologi</h3>
          <p className="truncate text-[11.5px] text-ink-2">
            RM <span className="font-mono">{gallery.noRkmMedis}</span>
            {gallery.noRawat ? <> · <span className="font-mono">{gallery.noRawat}</span></> : null}
          </p>
        </div>
      </figcaption>

      <div className="divide-y divide-line-2">
        {gallery.pemeriksaan.map((exam) => {
          const studies = byExam.get(exam) ?? [];
          return (
            <section key={`${exam.noRawat}|${exam.tanggal}|${exam.jam}`} className="space-y-3 px-3.5 py-3.5" data-testid="radiology-exam">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h4 className="font-display text-[14px] font-semibold">{exam.nama ?? "Pemeriksaan radiologi"}</h4>
                <span className="font-mono text-[11.5px] text-ink-2">
                  {dayLabel(exam.tanggal)} · {exam.jam}
                </span>
                {exam.dokter ? <span className="text-[11.5px] text-ink-3">{exam.dokter}</span> : null}
                {!gallery.noRawat ? <span className="font-mono text-[11.5px] text-ink-3">{exam.noRawat}</span> : null}
              </header>
              {exam.hasil ? <Reading text={exam.hasil} /> : <p className="text-[13px] text-ink-3">Belum ada hasil baca.</p>}
              {studies.map((study) => (
                <StudyThumbs key={study.id} study={study} onOpen={open(study)} />
              ))}
            </section>
          );
        })}

        {rest.map((study) => (
          <section key={study.id} className="space-y-3 px-3.5 py-3.5">
            <header className="flex flex-wrap items-baseline gap-x-3">
              <h4 className="font-display text-[14px] font-semibold">{study.description || "Gambar PACS"}</h4>
              <span className="font-mono text-[12px] text-ink-2">{dateLabel(study)}</span>
            </header>
            <StudyThumbs study={study} onOpen={open(study)} />
          </section>
        ))}

        {empty ? <p className="px-3.5 py-3.5 text-[12.5px] text-ink-3">Tidak ada pemeriksaan radiologi.</p> : null}
        {gallery.pacsCatatan ? <p className="px-3.5 py-2.5 text-[11.5px] text-ink-3">{gallery.pacsCatatan}</p> : null}
        {!gallery.pacsCatatan && gallery.pemeriksaan.length > 0 && gallery.studies.length === 0 ? (
          <p className="px-3.5 py-2.5 text-[11.5px] text-ink-3">Belum ada gambar di PACS untuk kunjungan ini.</p>
        ) : null}
      </div>

      <Viewer
        study={viewing?.study ?? null}
        start={viewing?.index ?? 0}
        viewerBase={gallery.viewerBase}
        onClose={() => setViewing(null)}
      />
    </figure>
  );
};

/** "Radiologi" button for the patient card. Renders nothing when the server has no PACS. */
export const RadiologyButton = ({ rm }: { readonly rm: string }) => {
  const health = useApi<{ readonly pacs?: boolean }>("/api/health");
  const [open, setOpen] = useState(false);
  if (!health.data?.pacs) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <ScanLine /> Radiologi
      </Button>
      <RadiologyDialog rm={rm} open={open} onOpenChange={setOpen} />
    </>
  );
};

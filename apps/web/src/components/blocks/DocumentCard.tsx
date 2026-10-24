/**
 * A patient document (riwayat, CPPT/SOAP, resume): a live preview of the
 * server-made HTML in a sandboxed frame (no scripts), with Print, Open and
 * Download. The HTML comes from Khanza data, not from the AI.
 */
import type { DocumentInfo } from "@simha/shared";
import { Download, ExternalLink, FileText, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { noRawatIn, noRmIn, type KhanzaForm } from "../../lib/desktop.ts";
import { cn } from "../../lib/cn.ts";
import { formatDateTime } from "../../lib/format.ts";
import { OpenInKhanza } from "../desktop/OpenInKhanza.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";

/** The Khanza form that matches each document. */
const KHANZA_FORM: Readonly<Record<DocumentInfo["jenis"], KhanzaForm>> = { riwayat: "riwayat", cppt: "soap", resume: "resume" };

/** The document is built for A4/190mm; render it at that width and scale it down for the panel. */
const DOC_WIDTH = 760;

const KIND_LABEL: Readonly<Record<DocumentInfo["jenis"], string>> = {
  riwayat: "Riwayat",
  cppt: "CPPT / SOAP",
  resume: "Resume",
};

export const DocumentCard = ({
  document,
  height = 520,
  fill = false,
  flat = false,
}: {
  readonly document: DocumentInfo;
  readonly height?: number | undefined;
  /** Fill the parent (the card panel) instead of using a fixed preview height. */
  readonly fill?: boolean | undefined;
  /** No card chrome: the panel's own background shows through. */
  readonly flat?: boolean | undefined;
}) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: height });
  const url = `/api/documents/${document.id}`;

  useEffect(() => {
    if (!fill) return;
    const el = preview.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const boxHeight = el.clientHeight;
      if (width === 0 || boxHeight === 0) return;
      const scale = Math.min(1, width / DOC_WIDTH);
      setFit({ scale, height: boxHeight / scale });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill]);

  return (
    <figure className={cn("animate-rise overflow-hidden", !flat && "rounded-xl border border-line bg-card", fill && "flex h-full min-h-0 flex-col")} data-testid="document-card">
      <figcaption className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-line-2 px-3.5 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-soft text-teal">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="teal">{KIND_LABEL[document.jenis]}</Badge>
              <h3 className="font-display text-[14.5px] leading-tight font-semibold">{document.judul}</h3>
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-ink-2">{document.subjek}</p>
            <p className="text-[11px] leading-snug text-ink-3">
              {document.ringkas} · {formatDateTime(document.dibuatPada)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <OpenInKhanza
            noRawat={noRawatIn(document.subjek)}
            noRm={noRmIn(document.subjek)}
            defaultForm={KHANZA_FORM[document.jenis]}
            className="mr-0.5"
          />
          <Button size="sm" variant="primary" onClick={() => frame.current?.contentWindow?.print()}>
            <Printer /> Cetak / PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.open(url, "_blank", "noopener")} title="Buka di tab baru" aria-label="Buka di tab baru">
            <ExternalLink />
          </Button>
          <a
            href={`${url}?download=1`}
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-paper-2 hover:text-ink"
            title="Unduh HTML"
            aria-label="Unduh HTML"
          >
            <Download className="size-4" />
          </a>
        </div>
      </figcaption>
      <div ref={preview} className={cn("relative bg-paper-2", fill ? "min-h-0 flex-1 overflow-hidden" : "")}>
        <iframe
          ref={frame}
          src={url}
          title={`${document.judul} – ${document.subjek}`}
          sandbox="allow-same-origin allow-modals"
          className={cn("block bg-paper-2", fill ? "absolute top-0 left-0 origin-top-left" : "w-full")}
          style={fill ? { width: DOC_WIDTH, height: fit.height, transform: `scale(${fit.scale})` } : { height }}
        />
      </div>
      <p className="shrink-0 border-t border-line-2 bg-paper/40 px-3.5 py-1.5 text-[10.5px] leading-snug text-ink-3">
        Disusun server dari data Khanza (bukan ditulis AI). Periksa kembali sebelum digunakan.
      </p>
    </figure>
  );
};

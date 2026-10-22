/**
 * A patient document (riwayat, CPPT/SOAP, resume): a live preview of the
 * server-made HTML in a sandboxed frame (no scripts), with Print, Open and
 * Download. The HTML comes from Khanza data, not from the AI.
 */
import type { DocumentInfo } from "@simrs/shared";
import { Download, ExternalLink, FileText, Printer } from "lucide-react";
import { useRef } from "react";
import { khanzaTarget } from "../../lib/desktop.ts";
import { formatDateTime } from "../../lib/format.ts";
import { OpenInKhanza } from "../desktop/OpenInKhanza.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";

const KIND_LABEL: Readonly<Record<DocumentInfo["jenis"], string>> = {
  riwayat: "Riwayat",
  cppt: "CPPT / SOAP",
  resume: "Resume",
};

export const DocumentCard = ({ document, height = 520 }: { readonly document: DocumentInfo; readonly height?: number }) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const url = `/api/documents/${document.id}`;
  return (
    <figure className="animate-rise overflow-hidden rounded-lg border border-line bg-card" data-testid="document-card">
      <figcaption className="flex flex-wrap items-start justify-between gap-2 border-b border-line-2 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-teal-soft text-teal">
            <FileText className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone="teal">{KIND_LABEL[document.jenis]}</Badge>
              <h3 className="font-display text-[16px] leading-tight font-semibold">{document.judul}</h3>
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-2">{document.subjek}</p>
            <p className="text-[12px] text-ink-3">
              {document.ringkas} · {formatDateTime(document.dibuatPada)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <OpenInKhanza copy={khanzaTarget(document.subjek)} className="mr-1" />
          <Button size="sm" variant="primary" onClick={() => frame.current?.contentWindow?.print()}>
            <Printer /> Cetak / PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.open(url, "_blank", "noopener")} title="Buka di tab baru">
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
      <iframe
        ref={frame}
        src={url}
        title={`${document.judul} – ${document.subjek}`}
        sandbox="allow-same-origin allow-modals"
        className="block w-full bg-paper-2"
        style={{ height }}
      />
      <p className="border-t border-line-2 bg-paper/40 px-4 py-1.5 text-[11.5px] text-ink-3">
        Disusun server dari data Khanza (bukan ditulis AI). Periksa kembali sebelum digunakan.
      </p>
    </figure>
  );
};

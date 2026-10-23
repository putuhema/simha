/**
 * Digital patient files (berkas digital) from Khanza: image thumbnails with a
 * full-size viewer, PDFs opened in the browser, and a download for anything
 * else. The bytes come through /api/berkas, never directly from the Khanza
 * folder. The card only lists files; the AI never sees their contents.
 */
import type { BerkasDigital, BerkasDigitalFile } from "@simha/shared";
import { Download, ExternalLink, FileText, FolderOpen, ImageOff, Info } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { formatBytes } from "../../lib/format.ts";
import { Badge } from "../ui/Badge.tsx";
import { Dialog } from "../ui/Dialog.tsx";

const urlFor = (file: BerkasDigitalFile, extra = "") =>
  `/api/berkas?noRawat=${encodeURIComponent(file.noRawat)}&kode=${encodeURIComponent(file.kode)}${extra}`;

const viewUrl = (file: BerkasDigitalFile) => urlFor(file, "&view=1");
const downloadUrl = (file: BerkasDigitalFile) => urlFor(file, "&download=1");

const ImageTile = ({ file, onOpen }: { readonly file: BerkasDigitalFile; readonly onOpen: () => void }) => (
  <button
    type="button"
    onClick={onOpen}
    disabled={!file.ada}
    className="group overflow-hidden rounded-lg border border-line bg-card text-left transition-[border-color] hover:border-ink-3/40 disabled:cursor-default disabled:opacity-60"
  >
    <span className="block aspect-[4/3] overflow-hidden bg-paper-2">
      {file.ada ? (
        <img
          src={urlFor(file)}
          alt={file.nama}
          loading="lazy"
          className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
      ) : (
        <span className="grid size-full place-items-center text-ink-3">
          <ImageOff className="size-6" strokeWidth={1.5} />
        </span>
      )}
    </span>
    <span className="block px-2.5 py-2">
      <span className="block truncate text-[12px] font-medium text-ink">{file.nama}</span>
      <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-3">
        {file.ada ? formatBytes(file.ukuran) || file.namaFile : "Tidak ada di server"}
      </span>
    </span>
  </button>
);

const PdfTile = ({ file, showVisit }: { readonly file: BerkasDigitalFile; readonly showVisit: boolean }) => (
  <div className="overflow-hidden rounded-lg border border-line bg-card">
    <div className="grid aspect-[4/3] place-items-center bg-red-soft/40 text-red">
      <FileText className="size-8" strokeWidth={1.5} aria-hidden />
    </div>
    <div className="space-y-1.5 px-2.5 py-2">
      <div>
        <p className="truncate text-[12px] font-medium text-ink">{file.nama}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
          {file.ada ? formatBytes(file.ukuran) || file.namaFile : "Tidak ada di server"}
        </p>
        {showVisit ? <p className="truncate font-mono text-[10px] text-ink-3">{file.noRawat}</p> : null}
      </div>
      {file.ada ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
          <a href={viewUrl(file)} target="_blank" rel="noreferrer" className="text-teal hover:underline">
            Buka PDF
          </a>
          <a href={downloadUrl(file)} className="inline-flex items-center gap-0.5 text-ink-3 hover:text-ink" aria-label={`Unduh ${file.nama}`}>
            <Download className="size-3" /> Unduh
          </a>
        </div>
      ) : null}
    </div>
  </div>
);

const OtherTile = ({ file, showVisit }: { readonly file: BerkasDigitalFile; readonly showVisit: boolean }) => (
  <div className="flex flex-col justify-between rounded-lg border border-line bg-card p-2.5">
    <div className="flex items-start gap-2">
      <FileText className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-ink">{file.nama}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-ink-3">{file.namaFile}</p>
        {showVisit ? <p className="truncate font-mono text-[10px] text-ink-3">{file.noRawat}</p> : null}
      </div>
    </div>
    {file.ada ? (
      <a href={downloadUrl(file)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-ink-2 hover:text-ink">
        <Download className="size-3" /> Unduh
      </a>
    ) : (
      <span className="mt-2 text-[11px] text-ink-3">Tidak ada di server</span>
    )}
  </div>
);

export const BerkasDigitalCard = ({ berkas }: { readonly berkas: BerkasDigital }) => {
  const [viewing, setViewing] = useState<BerkasDigitalFile | null>(null);
  const showVisit = berkas.noRawat === null;
  return (
    <figure className="animate-rise @container overflow-hidden rounded-xl border border-line bg-card" data-testid="berkas-card">
      <figcaption className="flex flex-wrap items-start gap-2.5 border-b border-line-2 px-3.5 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-soft text-teal">
          <FolderOpen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal">Berkas</Badge>
            <h3 className="font-display text-[14.5px] leading-tight font-semibold">Berkas digital</h3>
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-2">{berkas.subjek}</p>
          <p className="text-[11px] text-ink-3">{berkas.berkas.length} berkas digital</p>
        </div>
      </figcaption>

      <div className="space-y-3 px-3.5 py-3">
        {berkas.catatan ? (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-soft/60 px-2.5 py-1.5 text-[11px] leading-snug text-amber">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden /> {berkas.catatan}
          </p>
        ) : null}

        {berkas.berkas.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-ink-3">Tidak ada berkas digital untuk kunjungan ini.</p>
        ) : (
          <div className={cn("grid grid-cols-2 gap-2", "@[560px]:grid-cols-3")}>
            {berkas.berkas.map((file) => {
              if (file.jenis === "gambar") return <ImageTile key={`${file.noRawat}/${file.kode}`} file={file} onOpen={() => setViewing(file)} />;
              if (file.jenis === "pdf") return <PdfTile key={`${file.noRawat}/${file.kode}`} file={file} showVisit={showVisit} />;
              return <OtherTile key={`${file.noRawat}/${file.kode}`} file={file} showVisit={showVisit} />;
            })}
          </div>
        )}
      </div>

      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        title={viewing?.nama ?? "Berkas digital"}
        description={viewing ? `${viewing.namaFile}${formatBytes(viewing.ukuran) ? ` · ${formatBytes(viewing.ukuran)}` : ""}` : undefined}
        wide
      >
        {viewing ? (
          <div data-testid="berkas-viewer" className="space-y-3">
            <img src={viewUrl(viewing)} alt={viewing.nama} className="max-h-[68vh] w-full rounded-md bg-paper-2 object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-ink-3">Dikirim dari berkas digital Khanza.</p>
              <div className="flex items-center gap-2">
                <a href={downloadUrl(viewing)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-2 hover:bg-paper">
                  <Download className="size-3.5" /> Unduh
                </a>
                <a href={viewUrl(viewing)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-2 hover:bg-paper">
                  <ExternalLink className="size-3.5" /> Buka di tab baru
                </a>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </figure>
  );
};

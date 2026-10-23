/**
 * One Tanya Data result: title and assumption line, then the table, chart,
 * number or list, the SQL behind it, and actions (CSV, save as favorite).
 */
import type { RenderBlock } from "@simrs/shared";
import { Download, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api.ts";
import { downloadCsv, fileNameFor, toCsv } from "../../lib/csv.ts";
import { formatNumber } from "../../lib/format.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Textarea } from "../ui/Field.tsx";
import { chartHeight, chartOption } from "./chart-options.ts";
import { DataTable } from "./DataTable.tsx";
import { SqlDisclosure } from "./SqlSlip.tsx";

// ECharts is large; load it the first time a chart is shown.
const EChart = lazy(() => import("./EChart.tsx").then((m) => ({ default: m.EChart })));

const TYPE_LABEL: Readonly<Record<RenderBlock["tipe"], string>> = {
  table: "Tabel",
  bar: "Grafik batang",
  line: "Grafik garis",
  pie: "Grafik pai",
  stat: "Angka",
  list: "Daftar",
};

const StatValue = ({ block }: { readonly block: RenderBlock }) => {
  const row = block.baris[0] ?? {};
  const value = row[block.y[0] ?? ""];
  return (
    <div className="flex items-baseline gap-2 py-2">
      <span className="font-display text-[44px] leading-none font-semibold tracking-tight text-teal-2 tabular-nums">
        {formatNumber(value)}
      </span>
      {block.satuan ? <span className="text-[15px] text-ink-2">{block.satuan}</span> : null}
      {block.x ? <span className="ml-2 text-[13px] text-ink-3">{String(row[block.x] ?? "")}</span> : null}
    </div>
  );
};

export const RenderBlockView = ({ block, onSaved }: { readonly block: RenderBlock; readonly onSaved?: () => void }) => {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [sent, setSent] = useState<"up" | "down" | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [comment, setComment] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const option = useMemo(() => (["bar", "line", "pie"].includes(block.tipe) ? chartOption(block) : null), [block]);

  const save = async () => {
    setSaveState("saving");
    try {
      await api.post("/api/favorites", { blockId: block.id });
      setSaveState("saved");
      onSaved?.();
    } catch (error) {
      setSaveState(errorMessage(error));
    }
  };

  const sendFeedback = async (rating: "up" | "down") => {
    setSending(true);
    setFeedbackError(null);
    try {
      const trimmed = comment.trim();
      await api.post("/api/knowledge/feedback", {
        blockId: block.id,
        rating,
        ...(rating === "down" && trimmed !== "" ? { comment: trimmed } : {}),
      });
      setSent(rating);
      setCorrecting(false);
      setComment("");
    } catch (error) {
      setFeedbackError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <figure className="animate-rise overflow-hidden rounded-lg border border-line bg-card" data-testid="render-block">
      <figcaption className="flex flex-wrap items-start justify-between gap-2 border-b border-line-2 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone="teal">{TYPE_LABEL[block.tipe]}</Badge>
            <h3 className="font-display text-[16px] leading-tight font-semibold">{block.judul}</h3>
          </div>
          {block.asumsi ? <p className="mt-1 text-[12.5px] text-ink-2 italic">Asumsi: {block.asumsi}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {block.tipe !== "stat" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => downloadCsv(fileNameFor(block.judul), toCsv(block.kolom, block.baris))}
              title="Unduh CSV"
            >
              <Download /> CSV
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void save()} disabled={saveState === "saving" || saveState === "saved"}>
            <Star className={saveState === "saved" ? "fill-amber text-amber" : ""} />
            {saveState === "saved" ? "Tersimpan" : "Simpan ke favorit"}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Jawaban ini benar"
            title="Jawaban ini benar (simpan sebagai contoh)"
            onClick={() => void sendFeedback("up")}
            disabled={sending || sent === "up"}
            className={sent === "up" ? "text-ok" : ""}
          >
            <ThumbsUp className={sent === "up" ? "fill-ok" : ""} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Ada yang salah"
            title="Ada yang salah (beri koreksi)"
            onClick={() => setCorrecting(!correcting)}
            disabled={sending || sent === "down"}
            className={sent === "down" ? "text-red" : ""}
          >
            <ThumbsDown className={sent === "down" ? "fill-red" : ""} />
          </Button>
        </div>
      </figcaption>

      {correcting ? (
        <div className="border-b border-line-2 bg-paper/50 px-4 py-3">
          <p className="text-[12.5px] text-ink-2">
            Apa yang salah? Tulis aturan umumnya (tanpa nomor pasien), mis. “pasien BPJS memakai penjab BPJ”.
          </p>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={1_000}
            placeholder="Koreksi untuk AI…"
            aria-label="Koreksi"
            className="mt-2 text-[13px]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCorrecting(false);
                setComment("");
              }}
            >
              Batal
            </Button>
            <Button size="sm" variant="primary" onClick={() => void sendFeedback("down")} disabled={sending}>
              Kirim koreksi
            </Button>
          </div>
        </div>
      ) : null}

      {sent !== null || feedbackError !== null ? (
        <p className={`border-b border-line-2 px-4 py-2 text-[12.5px] ${feedbackError ? "bg-red-soft text-red" : "text-ok"}`}>
          {feedbackError ?? (sent === "up" ? "Terima kasih — contoh ini dipakai untuk pertanyaan serupa." : "Koreksi disimpan. Contoh otomatis untuk hasil ini dimatikan.")}
        </p>
      ) : null}

      <div className="px-4 py-3">
        {block.tipe === "stat" ? <StatValue block={block} /> : null}
        {block.tipe === "table" ? <DataTable columns={block.kolom} rows={block.baris} /> : null}
        {block.tipe === "list" ? (
          <ol className="list-decimal space-y-0.5 pl-5 text-[14px]">
            {block.baris.map((row, i) => (
              <li key={i}>{String(row[block.x ?? ""] ?? "")}</li>
            ))}
          </ol>
        ) : null}
        {option ? (
          block.baris.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-3">Tidak ada data untuk ditampilkan.</p>
          ) : (
            <Suspense fallback={<div style={{ height: chartHeight(block) }} className="animate-pulse rounded-md bg-paper-2/60" />}>
              <EChart option={option} height={chartHeight(block)} label={block.judul} />
            </Suspense>
          )
        ) : null}
        {block.terpotong ? (
          <p className="mt-2 text-[12.5px] text-amber">Hasil dipotong di 500 baris pertama.</p>
        ) : null}
        {typeof saveState === "string" && !["idle", "saving", "saved"].includes(saveState) ? (
          <p className="mt-2 text-[12.5px] text-red">{saveState}</p>
        ) : null}
      </div>

      <div className="border-t border-line-2 bg-paper/40 px-4 py-2">
        <SqlDisclosure sql={block.sql} />
      </div>
    </figure>
  );
};

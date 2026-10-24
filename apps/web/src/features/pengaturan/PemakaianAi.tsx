/**
 * AI usage and cost (admin): what the AI did in a period, how many tokens it
 * used, how much of the input came from the prompt cache, what it cost at
 * list prices, which questions were slow, who used it and why runs failed.
 *
 * Every number comes from the audit DB (agent_runs), so nothing here can
 * change Khanza. Costs are estimates: the price book is editable so the admin
 * can match the provider's invoice without a restart.
 */
import type { ModelPrice, UsageDay, UsageReport } from "@simha/shared";
import { Clock, Coins, Download, RefreshCw, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useState, type FormEvent, type ReactNode } from "react";
import type { ChartOption } from "../../components/blocks/EChart.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { ErrorText, Field, Input } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { api, errorMessage, request } from "../../lib/api.ts";
import { downloadCsvResponse } from "../../lib/csv.ts";
import { formatDateTime, formatDuration, formatNumber } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";

// ECharts is large; load it the first time this tab is opened.
const EChart = lazy(() => import("../../components/blocks/EChart.tsx").then((m) => ({ default: m.EChart })));

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const idrFormat = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const dayFormat = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });

const formatUsd = (value: number) => usdFormat.format(value);
const formatTokens = (value: number) => compactFormat.format(value);
const formatPercent = (value: number | null) => (value === null ? "–" : percentFormat.format(value));
const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00`));
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const daysAgo = (days: number) => {
  const now = new Date();
  return isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
};

const RANGE_PRESETS = [
  { days: 7, label: "7 hari" },
  { days: 30, label: "30 hari" },
  { days: 90, label: "90 hari" },
] as const;

const Stat = ({ label, value, hint }: { readonly label: string; readonly value: ReactNode; readonly hint?: ReactNode }) => (
  <div className="rounded-lg border border-line bg-card px-3.5 py-3">
    <p className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-ink-3 uppercase">{label}</p>
    <p className="mt-1 font-display text-[23px] leading-none font-semibold tracking-tight tabular-nums">{value}</p>
    {hint === undefined ? null : <p className="mt-1.5 text-[11.5px] text-ink-3">{hint}</p>}
  </div>
);

const Table = ({ head, children, empty }: { readonly head: ReactNode; readonly children: ReactNode; readonly empty?: string }) => (
  <div className="overflow-x-auto rounded-md border border-line-2">
    <table className="w-full border-collapse text-[13px]">
      <thead className="bg-paper-2 text-left font-mono text-[11.5px] font-medium text-ink-2">{head}</thead>
      <tbody>{children}</tbody>
    </table>
    {empty === undefined ? null : <p className="px-3 py-3 text-[12.5px] text-ink-3">{empty}</p>}
  </div>
);

const Th = ({ children, right = false }: { readonly children: ReactNode; readonly right?: boolean }) => (
  <th className={`border-b border-line px-3 py-1.5 whitespace-nowrap ${right ? "text-right" : ""}`}>{children}</th>
);

const Td = ({ children, right = false, className = "" }: { readonly children: ReactNode; readonly right?: boolean; readonly className?: string }) => (
  <td className={`border-b border-line-2 px-3 py-1.5 align-top last:border-0 ${right ? "text-right tabular-nums" : ""} ${className}`}>
    {children}
  </td>
);

// --- Charts ---------------------------------------------------------------

const INK = "#1a1f1e";
const MUTED = "#878d8a";
const LINE = "#efede7";
const COLORS = { ok: "#59b89f", red: "#b42318", amber: "#b45309", blue: "#3f5c8a", teal: "#163f35" };

const chartBase = (days: ReadonlyArray<UsageDay>) => ({
  textStyle: { fontFamily: "IBM Plex Sans, sans-serif", color: INK },
  animationDuration: 400,
  grid: { left: 8, right: 12, top: 30, bottom: 8, containLabel: true },
  tooltip: {
    trigger: "axis" as const,
    backgroundColor: "#ffffff",
    borderColor: "#e3e0d8",
    textStyle: { color: INK, fontFamily: "IBM Plex Sans, sans-serif", fontSize: 12 },
  },
  xAxis: {
    type: "category" as const,
    data: days.map((day) => formatDay(day.day)),
    axisLine: { lineStyle: { color: "#e3e0d8" } },
    axisTick: { show: false },
    axisLabel: { color: MUTED, fontSize: 11, hideOverlap: true },
  },
  yAxis: {
    type: "value" as const,
    splitLine: { lineStyle: { color: LINE } },
    axisLabel: { color: MUTED, fontSize: 11 },
  },
});

const runsOption = (days: ReadonlyArray<UsageDay>) => ({
  ...chartBase(days),
  legend: { top: 0, textStyle: { color: MUTED, fontSize: 11 } },
  tooltip: { ...chartBase(days).tooltip, valueFormatter: (value: unknown) => formatNumber(value) },
  series: [
    {
      name: "Pertanyaan",
      type: "bar",
      data: days.map((day) => day.runs),
      barMaxWidth: 18,
      itemStyle: { color: COLORS.ok, borderRadius: [3, 3, 0, 0] },
    },
    // A zero line across every day is noise; only draw failures when there are some.
    ...(days.some((day) => day.failed > 0)
      ? [
          {
            name: "Gagal",
            type: "line",
            data: days.map((day) => day.failed),
            smooth: 0.2,
            symbolSize: 5,
            itemStyle: { color: COLORS.red },
            lineStyle: { width: 2, color: COLORS.red },
          },
        ]
      : []),
  ],
});

const tokensOption = (days: ReadonlyArray<UsageDay>) => ({
  ...chartBase(days),
  legend: { top: 0, textStyle: { color: MUTED, fontSize: 11 } },
  tooltip: { ...chartBase(days).tooltip, valueFormatter: (value: unknown) => formatNumber(value) },
  series: [
    {
      name: "Input baru",
      type: "bar",
      stack: "token",
      data: days.map((day) => Math.max(0, day.inputTokens - day.cachedInputTokens - day.cacheWriteTokens)),
      barMaxWidth: 18,
      itemStyle: { color: COLORS.ok },
    },
    { name: "Cache dibaca", type: "bar", stack: "token", data: days.map((day) => day.cachedInputTokens), itemStyle: { color: COLORS.blue } },
    { name: "Cache ditulis", type: "bar", stack: "token", data: days.map((day) => day.cacheWriteTokens), itemStyle: { color: COLORS.amber } },
    {
      name: "Output",
      type: "bar",
      stack: "token",
      data: days.map((day) => day.outputTokens),
      itemStyle: { color: COLORS.teal, borderRadius: [3, 3, 0, 0] },
    },
  ],
});

const costOption = (days: ReadonlyArray<UsageDay>) => ({
  ...chartBase(days),
  tooltip: { ...chartBase(days).tooltip, valueFormatter: (value: unknown) => (typeof value === "number" ? formatUsd(value) : String(value)) },
  series: [
    {
      name: "Biaya",
      type: "bar",
      data: days.map((day) => day.costUsd),
      barMaxWidth: 18,
      itemStyle: { color: COLORS.amber, borderRadius: [3, 3, 0, 0] },
    },
  ],
});

const Chart = ({ option, label }: { readonly option: ChartOption; readonly label: string }) => (
  <Suspense fallback={<div className="h-[190px]" />}>
    <EChart option={option} height={190} label={label} />
  </Suspense>
);

// --- Price book dialog ----------------------------------------------------

interface PriceRow {
  readonly provider: string;
  readonly model: string;
  /** A price was in effect for this model, so clearing it to 0 means "free", not "unpriced". */
  readonly priced: boolean;
  readonly input: string;
  readonly output: string;
  readonly cachedInput: string;
  readonly cacheWrite: string;
}

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const PriceDialog = ({ report, onClose, onSaved }: { readonly report: UsageReport; readonly onClose: () => void; readonly onSaved: () => void }) => {
  const [rows, setRows] = useState<ReadonlyArray<PriceRow>>(() =>
    report.models.map((model) => {
      const price = report.prices.models.find((p) => p.provider === model.provider && p.model === model.model);
      return {
        provider: model.provider,
        model: model.model,
        priced: price !== undefined,
        input: price === undefined ? "" : String(price.input),
        output: price === undefined ? "" : String(price.output),
        cachedInput: price === undefined ? "" : String(price.cachedInput),
        cacheWrite: price === undefined ? "" : String(price.cacheWrite),
      };
    }),
  );
  const [rate, setRate] = useState(report.prices.usdIdr === 0 ? "" : String(report.prices.usdIdr));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setRow = (index: number, change: Partial<PriceRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const prices: Array<ModelPrice> = [];
    for (const row of rows) {
      const input = numberOrNull(row.input);
      const output = numberOrNull(row.output);
      const cachedInput = numberOrNull(row.cachedInput);
      const cacheWrite = numberOrNull(row.cacheWrite);
      if (input === null || output === null || cachedInput === null || cacheWrite === null) {
        setError(`Harga untuk ${row.model} harus angka 0 atau lebih.`);
        return;
      }
      // Leaving every field empty on a model that had no price keeps it unpriced;
      // it is not the same as "the provider charges nothing".
      if (!row.priced && input === 0 && output === 0 && cachedInput === 0 && cacheWrite === 0) continue;
      prices.push({ provider: row.provider, model: row.model, input, output, cachedInput, cacheWrite });
    }
    const usdIdr = numberOrNull(rate);
    if (usdIdr === null) {
      setError("Kurs USD→IDR harus angka 0 atau lebih.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/api/usage/prices", { usdIdr, models: prices });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())} title="Harga model" description="USD per 1 juta token. Biaya di halaman ini hanya perkiraan; samakan dengan tagihan provider." wide>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-2">Belum ada model pada periode ini.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line-2">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-paper-2 text-left font-mono text-[11px] font-medium text-ink-2">
                <tr>
                  <th className="border-b border-line px-3 py-1.5">Model</th>
                  <th className="border-b border-line px-2 py-1.5 text-right">Input</th>
                  <th className="border-b border-line px-2 py-1.5 text-right">Output</th>
                  <th className="border-b border-line px-2 py-1.5 text-right">Cache baca</th>
                  <th className="border-b border-line px-2 py-1.5 text-right">Cache tulis</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.provider}/${row.model}`} className="border-b border-line-2 last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-mono text-[12px] text-ink">{row.model}</p>
                      <p className="text-[11px] text-ink-3">
                        {row.provider}
                        {row.priced ? "" : " · belum diatur"}
                      </p>
                    </td>
                    {(["input", "output", "cachedInput", "cacheWrite"] as const).map((field) => (
                      <td key={field} className="px-2 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={row[field]}
                          onChange={(e) => setRow(index, { [field]: e.target.value })}
                          placeholder="0"
                          className="h-8 w-24 text-right font-mono text-[12px]"
                          aria-label={`${field} ${row.model}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Field label="Kurs USD → IDR" hint="Opsional, mis. 16500. Kosongkan untuk menampilkan biaya hanya dalam USD.">
          <Input type="number" min="0" step="1" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="h-9 w-40 font-mono" />
        </Field>
        <p className="text-[11.5px] text-ink-3">
          Kosongkan semua harga sebuah model untuk membiarkannya tanpa harga; biayanya tidak dihitung dan muncul sebagai “belum ada harga”. Isi 0 bila provider benar-benar tidak menagih token itu
          (model lokal).
        </p>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            Simpan harga
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// --- Page -----------------------------------------------------------------

export const PemakaianAi = () => {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [priceOpen, setPriceOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const report = useApi<UsageReport>(from !== "" && to !== "" ? `/api/usage?from=${from}&to=${to}` : null);

  const setRange = (days: number) => {
    setFrom(daysAgo(days - 1));
    setTo(isoDay(new Date()));
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await request("GET", `/api/usage/export?from=${from}&to=${to}`);
      downloadCsvResponse(`pemakaian-ai-${from}-sd-${to}.csv`, await response.blob());
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const data = report.data;
  const rate = data?.prices.usdIdr ?? 0;
  const rupiah = (value: number) => (rate > 0 ? idrFormat.format(value * rate) : null);
  const averageMs = data && data.totals.ok + data.totals.failed > 0 ? data.totals.durationMs / (data.totals.ok + data.totals.failed) : null;

  return (
    <div className="space-y-4">
      <Panel
        title="Pemakaian AI"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => void report.reload()} aria-label="Muat ulang" title="Muat ulang">
              <RefreshCw /> <span className="hidden sm:inline">Muat ulang</span>
            </Button>
            <Button size="sm" onClick={() => setPriceOpen(true)} disabled={data === undefined} aria-label="Harga model">
              <Coins /> <span className="hidden sm:inline">Harga model</span>
            </Button>
            <Button size="sm" variant="primary" onClick={() => void exportCsv()} disabled={exporting || data === undefined} aria-label="Unduh CSV">
              {exporting ? <Spinner className="size-3.5" /> : <Download />} <span className="hidden sm:inline">CSV</span>
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-md bg-paper-2 p-0.5">
            {RANGE_PRESETS.map((preset) => {
              const active = from === daysAgo(preset.days - 1) && to === isoDay(new Date());
              return (
                <button
                  key={preset.days}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRange(preset.days)}
                  className={`rounded px-2.5 py-1 text-[12.5px] ${active ? "bg-card font-medium shadow-sm" : "text-ink-2 hover:text-ink"}`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" aria-label="Dari tanggal" />
          <span className="text-ink-3">–</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" aria-label="Sampai tanggal" />
          {report.loading ? <Spinner className="text-ink-3" /> : null}
          <span className="ml-auto text-[11.5px] text-ink-3">
            {data ? `${data.totals.runs} pertanyaan · ${formatDay(data.from)} – ${formatDay(data.to)}` : "Dihitung dari audit log"}
          </span>
        </div>
        <ErrorText>{report.error}</ErrorText>
        <ErrorText>{exportError}</ErrorText>
        {data && data.totals.noTokenRuns > 0 ? (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-amber/25 bg-amber-soft px-3 py-2 text-[12.5px] text-amber">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {data.totals.noTokenRuns} pertanyaan belum punya data token, jadi tidak masuk hitungan token dan biaya. Pertanyaan yang dibuat setelah pencatatan token aktif akan terisi.
          </p>
        ) : null}
        {data && data.totals.unpricedRuns > 0 ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber/25 bg-amber-soft px-3 py-2 text-[12.5px] text-amber">
            <TriangleAlert className="size-3.5 shrink-0" />
            <span>{data.totals.unpricedRuns} pertanyaan memakai model yang belum punya harga, jadi biayanya belum masuk estimasi.</span>
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => setPriceOpen(true)}>
              Atur harga
            </button>
          </p>
        ) : null}
      </Panel>

      {data === undefined ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat label="Pertanyaan" value={formatNumber(data.totals.runs)} hint={`${formatNumber(data.totals.ok)} selesai · ${formatNumber(data.totals.failed)} gagal`} />
            <Stat label="Pengguna" value={formatNumber(data.totals.users)} hint="akun SIMRS yang bertanya" />
            <Stat label="Token" value={formatTokens(data.totals.inputTokens + data.totals.outputTokens)} hint={`${formatTokens(data.totals.inputTokens)} masuk · ${formatTokens(data.totals.outputTokens)} keluar`} />
            <Stat label="Cache prompt" value={formatPercent(data.totals.cacheHitRate)} hint={`${formatTokens(data.totals.cachedInputTokens)} dari ${formatTokens(data.totals.inputTokens)} token masuk dibaca dari cache`} />
            <Stat
              label="Estimasi biaya"
              value={
                data.totals.runs > 0 && (data.totals.unpricedRuns === data.totals.runs || data.totals.noTokenRuns === data.totals.runs)
                  ? "–"
                  : formatUsd(data.totals.costUsd)
              }
              hint={rupiah(data.totals.costUsd) ?? "USD, harga list per model"}
            />
            <Stat label="Waktu AI" value={averageMs === null ? "–" : formatDuration(averageMs)} hint={`rata-rata per pertanyaan · ${formatDuration(data.totals.durationMs)} total`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Pertanyaan per hari" bodyClassName="p-3">
              <Chart option={runsOption(data.days)} label="Grafik pertanyaan per hari" />
            </Panel>
            <Panel title="Token per hari" bodyClassName="p-3">
              <Chart option={tokensOption(data.days)} label="Grafik token per hari" />
            </Panel>
            <Panel title="Biaya per hari" bodyClassName="p-3">
              <Chart option={costOption(data.days)} label="Grafik estimasi biaya per hari" />
            </Panel>
          </div>

          <Panel title="Per model" actions={<span className="text-[11.5px] text-ink-3">USD per 1 juta token</span>}>
            {data.models.length === 0 ? (
              <p className="text-[13px] text-ink-3">Belum ada pertanyaan pada periode ini.</p>
            ) : (
              <Table
                head={
                  <tr>
                    <Th>Provider · model</Th>
                    <Th right>Pertanyaan</Th>
                    <Th right>Gagal</Th>
                    <Th right>Token masuk</Th>
                    <Th right>Token keluar</Th>
                    <Th right>Cache</Th>
                    <Th right>Biaya</Th>
                  </tr>
                }
              >
                {data.models.map((model) => (
                  <tr key={`${model.provider}/${model.model}`} className="hover:bg-paper/60">
                    <Td>
                      <p className="font-mono text-[12px]">{model.model}</p>
                      <p className="text-[11px] text-ink-3">{model.provider}</p>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {model.unpricedRuns > 0 ? <Badge tone="amber">tanpa harga</Badge> : null}
                        {model.noTokenRuns > 0 ? <Badge tone="neutral">tanpa token</Badge> : null}
                      </span>
                    </Td>
                    <Td right>{formatNumber(model.runs)}</Td>
                    <Td right>{model.failed === 0 ? "–" : formatNumber(model.failed)}</Td>
                    <Td right>
                      {formatNumber(model.inputTokens)}
                      <span className="ml-1 text-[11px] text-ink-3">({formatTokens(model.cachedInputTokens)})</span>
                    </Td>
                    <Td right>{formatNumber(model.outputTokens)}</Td>
                    <Td right>{formatPercent(model.cacheHitRate)}</Td>
                    <Td right>
                      {model.unpricedRuns === model.runs || model.noTokenRuns === model.runs ? "–" : formatUsd(model.costUsd)}
                      {model.unpricedRuns > 0 && model.unpricedRuns < model.runs ? (
                        <span className="ml-1 text-[11px] text-amber">sebagian</span>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Per pengguna">
              {data.users.length === 0 ? (
                <p className="text-[13px] text-ink-3">Belum ada pengguna pada periode ini.</p>
              ) : (
                <Table
                  head={
                    <tr>
                      <Th>Pengguna</Th>
                      <Th right>Pertanyaan</Th>
                      <Th right>Gagal</Th>
                      <Th right>Token masuk</Th>
                      <Th right>Biaya</Th>
                    </tr>
                  }
                >
                  {data.users.map((user) => (
                    <tr key={user.user ?? "(tidak tercatat)"} className="hover:bg-paper/60">
                      <Td className="font-mono text-[12px]">{user.user ?? "(tidak tercatat)"}</Td>
                      <Td right>{formatNumber(user.runs)}</Td>
                      <Td right>{user.failed === 0 ? "–" : formatNumber(user.failed)}</Td>
                      <Td right>{formatNumber(user.inputTokens)}</Td>
                      <Td right>{formatUsd(user.costUsd)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>

            <Panel title="Gagal menurut provider">
              {data.failures.length === 0 ? (
                <p className="text-[13px] text-ink-3">Tidak ada kegagalan pada periode ini.</p>
              ) : (
                <Table
                  head={
                    <tr>
                      <Th>Provider · model</Th>
                      <Th right>Error</Th>
                      <Th right>Terputus</Th>
                      <Th>Error terakhir</Th>
                    </tr>
                  }
                >
                  {data.failures.map((failure) => (
                    <tr key={`${failure.provider}/${failure.model}`} className="hover:bg-paper/60">
                      <Td>
                        <p className="font-mono text-[12px]">{failure.model}</p>
                        <p className="text-[11px] text-ink-3">{failure.provider}</p>
                      </Td>
                      <Td right>{failure.errors === 0 ? "–" : formatNumber(failure.errors)}</Td>
                      <Td right>{failure.interrupted === 0 ? "–" : formatNumber(failure.interrupted)}</Td>
                      <Td>
                        <p className="max-w-[280px] truncate text-[12px]" title={failure.lastError ?? ""}>
                          {failure.lastError ?? "–"}
                        </p>
                        <p className="text-[11px] text-ink-3">{failure.lastAt ? formatDateTime(failure.lastAt) : ""}</p>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
          </div>

          <Panel title="Pertanyaan paling lambat" actions={<Clock className="size-3.5 text-ink-3" />}>
            {data.slowest.length === 0 ? (
              <p className="text-[13px] text-ink-3">Belum ada pertanyaan selesai pada periode ini.</p>
            ) : (
              <Table
                head={
                  <tr>
                    <Th>Pertanyaan</Th>
                    <Th>Pengguna</Th>
                    <Th right>Waktu</Th>
                    <Th right>Langkah</Th>
                    <Th right>Token masuk</Th>
                    <Th right>Biaya</Th>
                    <Th>Mulai</Th>
                  </tr>
                }
              >
                {data.slowest.map((question) => (
                  <tr key={question.id} className="hover:bg-paper/60">
                    <Td className="max-w-[360px]">
                      <p className="truncate" title={question.question}>
                        {question.question}
                      </p>
                      <p className="font-mono text-[11px] text-ink-3">
                        {question.provider} · {question.model}
                      </p>
                    </Td>
                    <Td className="font-mono text-[12px]">{question.askedBy ?? "–"}</Td>
                    <Td right>{formatDuration(question.durationMs)}</Td>
                    <Td right>{formatNumber(question.steps)}</Td>
                    <Td right>{formatNumber(question.inputTokens)}</Td>
                    <Td right>{question.costUsd === null ? "–" : formatUsd(question.costUsd)}</Td>
                    <Td className="text-[12px] whitespace-nowrap text-ink-3">{formatDateTime(question.startedAt)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </>
      )}

      {priceOpen && data ? <PriceDialog report={data} onClose={() => setPriceOpen(false)} onSaved={() => void report.reload()} /> : null}
    </div>
  );
};

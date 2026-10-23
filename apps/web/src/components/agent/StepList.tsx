/**
 * "Yang dicek AI": every tool call as a line with a mark (✓ fine, ! problem
 * found, ✕ failed), a one-line summary, and details on click.
 */
import { Collapsible } from "@base-ui/react/collapsible";
import {
  AppWindow,
  ArrowLeftRight,
  BedDouble,
  BookOpen,
  Boxes,
  CalendarCheck,
  ChartColumn,
  ChevronRight,
  Database,
  FileCheck,
  FilePenLine,
  FileText,
  FolderOpen,
  History,
  IdCard,
  PencilLine,
  Receipt,
  ScanLine,
  ShieldCheck,
  Stethoscope,
  Terminal,
  UserSearch,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { formatDuration } from "../../lib/format.ts";
import { draftPreview, findingsOf, stepLabel, stepMark, stepSummary, stepTarget, type StepMark, type StepView } from "../../lib/steps.ts";

const MARK: Readonly<Record<StepMark, { readonly symbol: string; readonly className: string; readonly label: string }>> = {
  ok: { symbol: "✓", className: "bg-ok-soft text-ok", label: "baik" },
  warn: { symbol: "!", className: "bg-amber-soft text-amber", label: "ada temuan" },
  error: { symbol: "✕", className: "bg-red-soft text-red", label: "gagal" },
  running: { symbol: "", className: "bg-teal-soft text-teal", label: "berjalan" },
};

const FINDING_TONE: Readonly<Record<string, string>> = { ok: "text-ok", masalah: "text-amber", info: "text-ink-3" };

/** One recognizable glyph per tool, so a long checklist can be scanned by shape. */
const TOOL_ICON: Readonly<Record<string, typeof Boxes>> = {
  cariPasien: UserSearch,
  kunjunganAktif: CalendarCheck,
  riwayatKamar: History,
  statusKamar: BedDouble,
  daftarTindakan: Stethoscope,
  statusBilling: Receipt,
  dataSep: ShieldCheck,
  suratKontrol: FileCheck,
  kartuPasien: IdCard,
  dokumenPasien: FileText,
  berkasDigital: FolderOpen,
  buatDraftResume: FilePenLine,
  isiDraft: PencilLine,
  hasilRadiologi: ScanLine,
  diagnosaPindahKamar: ArrowLeftRight,
  diagnosaTindakan: Stethoscope,
  usulkanPerbaikan: Wrench,
  lihatSkema: Database,
  cariAplikasiKhanza: AppWindow,
  catatPengetahuan: BookOpen,
  jalankanQueryBaca: Terminal,
  tampilkan: ChartColumn,
};

const Json = ({ value }: { readonly value: unknown }) => (
  <pre className="max-h-64 overflow-auto rounded-md bg-paper-2 p-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap text-ink-2">
    {JSON.stringify(value, null, 2)}
  </pre>
);

const Step = ({ step }: { readonly step: StepView }) => {
  const mark = stepMark(step);
  const { symbol, className, label } = MARK[mark];
  const findings = findingsOf(step.output);
  const preview = step.draft !== null ? draftPreview(step.draft) : "";
  const ToolIcon = TOOL_ICON[step.name] ?? Boxes;
  const iconTone =
    mark === "error" ? "text-red" : mark === "warn" ? "text-amber" : mark === "running" ? "text-teal" : "text-ink-3";
  return (
    <li className="relative pl-8" data-testid="step" data-mark={mark}>
      <span
        aria-label={label}
        className={cn("absolute top-0.5 left-0 grid size-5 place-items-center rounded-full font-mono text-[11px] font-semibold", className)}
      >
        {mark === "running" ? <span className="size-1.5 rounded-full bg-teal" /> : symbol}
      </span>
      <Collapsible.Root>
        <Collapsible.Trigger className="group flex w-full items-start gap-1 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <ToolIcon className={cn("size-3.5 shrink-0", iconTone)} aria-hidden />
                <span className="font-medium text-ink">{stepLabel(step.name)}</span>
              </span>
              <span className="truncate font-mono text-[12px] text-ink-3">{stepTarget(step.input)}</span>
            </div>
            <p className={cn("text-[13px]", mark === "error" ? "text-red" : mark === "warn" ? "text-amber" : "text-ink-2")}>
              {step.running ? <span className="shimmer">{stepSummary(step)}</span> : stepSummary(step)}
              {step.durationMs !== null && !step.running ? (
                <span className="ml-2 font-mono text-[11px] text-ink-3">{formatDuration(step.durationMs)}</span>
              ) : null}
            </p>
          </div>
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-ink-3 transition-transform group-data-[panel-open]:rotate-90" />
        </Collapsible.Trigger>
        {preview ? (
          <pre
            data-testid="step-draft"
            className="mt-1.5 max-h-40 overflow-auto rounded-md bg-paper-2 p-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap text-ink-2"
          >
            {preview}
            <span className="ml-px inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-teal" />
          </pre>
        ) : null}
        <Collapsible.Panel className="mt-2 space-y-2">
          {findings.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-line-2 p-2 text-[13px]">
              {findings.map((f) => (
                <li key={f.cek}>
                  <span className={cn("font-medium", FINDING_TONE[f.hasil])}>{f.cek}:</span> {f.keterangan}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="eyebrow">Input</p>
          {step.draft !== null ? <Json value={step.draft} /> : <Json value={step.input} />}
          {step.output !== null ? (
            <>
              <p className="eyebrow">Hasil</p>
              <Json value={step.output} />
            </>
          ) : null}
        </Collapsible.Panel>
      </Collapsible.Root>
    </li>
  );
};

/** Seconds since `since`, ticking once a second. */
const useElapsedSeconds = (since: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return Math.max(0, Math.floor((now - since) / 1000));
};

/** What the AI is doing between tool calls, with a timer so a slow model does not look stuck. */
export interface PendingStep {
  readonly label: string;
  readonly since: number;
  /** The model's thinking so far, if the provider streams it. */
  readonly reasoning?: string;
}

/** The model is working on its next turn: no tool is running yet. */
export const pendingStep = (run: {
  readonly status: string;
  readonly steps: ReadonlyArray<StepView>;
  readonly writing: boolean;
  readonly waitingSince: number;
  readonly reasoning: string;
}): PendingStep | null =>
  // While answer text streams in, the text itself shows the AI is working.
  run.status !== "running" || run.writing || run.steps.some((s) => s.running)
    ? null
    : { label: "AI sedang berpikir…", since: run.waitingSince, reasoning: run.reasoning };

/** The last few hundred characters of the thinking, so the line stays short. */
const reasoningTail = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > 280 ? `…${trimmed.slice(-280)}` : trimmed;
};

export const PendingLine = ({ pending }: { readonly pending: PendingStep }) => {
  const seconds = useElapsedSeconds(pending.since);
  const thinking = pending.reasoning ? reasoningTail(pending.reasoning) : "";
  return (
    <span className="block text-[13px] text-ink-3" data-testid="pending-step">
      <span className="shimmer">{pending.label}</span>
      {seconds > 0 ? <span className="ml-2 font-mono text-[11px]">{seconds} dtk</span> : null}
      {thinking ? (
        <span data-testid="pending-reasoning" className="mt-1 block text-[12px] leading-snug whitespace-pre-wrap text-ink-3/80 italic">
          {thinking}
        </span>
      ) : null}
    </span>
  );
};

export const StepList = ({
  steps,
  pending = null,
}: {
  readonly steps: ReadonlyArray<StepView>;
  readonly pending?: PendingStep | null;
}) =>
  steps.length === 0 && pending === null ? null : (
    <ol className="stagger relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[9.5px] before:w-px before:bg-line">
      {steps.map((step) => (
        <Step key={step.id} step={step} />
      ))}
      {pending ? (
        <li className="relative pl-8">
          <span className={cn("absolute top-0.5 left-0 grid size-5 place-items-center rounded-full", MARK.running.className)}>
            <span className="size-1.5 rounded-full bg-teal" />
          </span>
          <PendingLine pending={pending} />
        </li>
      ) : null}
    </ol>
  );

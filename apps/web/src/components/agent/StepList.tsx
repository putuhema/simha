/**
 * "Yang dicek AI": every tool call as a line with a mark (✓ fine, ! problem
 * found, ✕ failed), a one-line summary, and details on click.
 */
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { formatDuration } from "../../lib/format.ts";
import { findingsOf, stepLabel, stepMark, stepSummary, stepTarget, type StepMark, type StepView } from "../../lib/steps.ts";
import { Spinner } from "../ui/Spinner.tsx";

const MARK: Readonly<Record<StepMark, { readonly symbol: string; readonly className: string; readonly label: string }>> = {
  ok: { symbol: "✓", className: "bg-ok-soft text-ok", label: "baik" },
  warn: { symbol: "!", className: "bg-amber-soft text-amber", label: "ada temuan" },
  error: { symbol: "✕", className: "bg-red-soft text-red", label: "gagal" },
  running: { symbol: "", className: "bg-teal-soft text-teal", label: "berjalan" },
};

const FINDING_TONE: Readonly<Record<string, string>> = { ok: "text-ok", masalah: "text-amber", info: "text-ink-3" };

const Json = ({ value }: { readonly value: unknown }) => (
  <pre className="max-h-64 overflow-auto rounded-md bg-paper-2 p-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap text-ink-2">
    {JSON.stringify(value, null, 2)}
  </pre>
);

const Step = ({ step }: { readonly step: StepView }) => {
  const mark = stepMark(step);
  const { symbol, className, label } = MARK[mark];
  const findings = findingsOf(step.output);
  return (
    <li className="relative pl-8" data-testid="step" data-mark={mark}>
      <span
        aria-label={label}
        className={cn("absolute top-0.5 left-0 grid size-5 place-items-center rounded-full font-mono text-[11px] font-semibold", className)}
      >
        {mark === "running" ? <Spinner className="size-3" /> : symbol}
      </span>
      <Collapsible.Root>
        <Collapsible.Trigger className="group flex w-full items-start gap-1 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-ink">{stepLabel(step.name)}</span>
              <span className="truncate font-mono text-[12px] text-ink-3">{stepTarget(step.input)}</span>
            </div>
            <p className={cn("text-[13px]", mark === "error" ? "text-red" : mark === "warn" ? "text-amber" : "text-ink-2")}>
              {stepSummary(step)}
              {step.durationMs !== null && !step.running ? (
                <span className="ml-2 font-mono text-[11px] text-ink-3">{formatDuration(step.durationMs)}</span>
              ) : null}
            </p>
          </div>
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-ink-3 transition-transform group-data-[panel-open]:rotate-90" />
        </Collapsible.Trigger>
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
          <Json value={step.input} />
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

export const StepList = ({ steps }: { readonly steps: ReadonlyArray<StepView> }) =>
  steps.length === 0 ? null : (
    <ol className="stagger relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[9.5px] before:w-px before:bg-line">
      {steps.map((step) => (
        <Step key={step.id} step={step} />
      ))}
    </ol>
  );

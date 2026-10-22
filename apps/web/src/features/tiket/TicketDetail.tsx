/**
 * Middle column: the complaint, then each investigation: "Yang dicek AI",
 * the diagnosis, "Saran perbaikan" with the proposed fixes, and a box for
 * follow-up questions.
 */
import type { Fix, Ticket } from "@simrs/shared";
import { CheckCircle2, CircleSlash, RotateCw, SendHorizontal, Square } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Markdown } from "../../components/agent/Markdown.tsx";
import { PendingLine, pendingStep, StepList } from "../../components/agent/StepList.tsx";
import { DocumentCard } from "../../components/blocks/DocumentCard.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { ErrorText, Textarea } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { splitAnswer } from "../../lib/answer.ts";
import { formatDateTime } from "../../lib/format.ts";
import type { RunView } from "../../lib/run.ts";
import { FixCard } from "./FixCard.tsx";
import { TICKET_STATUS } from "./TicketList.tsx";

const Box = ({ label, tone, children }: { readonly label: string; readonly tone: "teal" | "amber"; readonly children: React.ReactNode }) => (
  <section
    className={`rounded-lg border px-4 py-3 ${tone === "teal" ? "border-teal/25 bg-teal-soft/40" : "border-amber/25 bg-amber-soft/40"}`}
  >
    <h3 className={`eyebrow mb-1 ${tone === "teal" ? "text-teal!" : "text-amber!"}`}>{label}</h3>
    {children}
  </section>
);

const RunSection = ({
  run,
  first,
  fixes,
  onFixChanged,
}: {
  readonly run: RunView;
  readonly first: boolean;
  readonly fixes: ReadonlyArray<Fix>;
  readonly onFixChanged: () => void;
}) => {
  const sections = splitAnswer(run.text);
  const runFixes = fixes.filter((f) => run.fixIds.includes(f.id));
  const hasSections = Boolean(sections.diagnosis || sections.suggestion);
  return (
    <div className="space-y-4" data-testid="ticket-run">
      {!first ? (
        <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-teal-2 px-3 py-2 text-[13.5px] text-paper">{run.question}</div>
      ) : null}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="eyebrow">Yang dicek AI</h3>
          <span className="font-mono text-[11px] text-ink-3">
            {run.model ?? ""}
            {run.askedBy ? ` · ${run.askedBy}` : ""} · {formatDateTime(run.at)}
          </span>
        </div>
        {run.steps.length === 0 && run.status === "running" ? (
          <p className="flex items-start gap-2 text-[13px] text-ink-3">
            <PendingLine pending={{ label: "AI sedang membaca keluhan…", since: run.waitingSince, reasoning: run.reasoning }} />
          </p>
        ) : (
          <StepList steps={run.steps} pending={pendingStep(run)} />
        )}
      </div>

      {run.documents.map((document) => (
        <DocumentCard key={document.id} document={document} />
      ))}
      {run.status === "running" && run.text ? <Markdown text={run.text} className="text-ink-2" /> : null}

      {run.status !== "running" ? (
        <>
          {sections.intro && hasSections ? <Markdown text={sections.intro} /> : null}
          {!hasSections && run.text ? <Markdown text={run.text} /> : null}
          {sections.diagnosis ? (
            <Box label="Diagnosis" tone="teal">
              <Markdown text={sections.diagnosis} />
            </Box>
          ) : null}
          {sections.suggestion || runFixes.length > 0 ? (
            <Box label="Saran perbaikan" tone="amber">
              {sections.suggestion ? <Markdown text={sections.suggestion} /> : null}
              {runFixes.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {runFixes.map((f) => (
                    <FixCard key={f.id} fixId={f.id} onChanged={onFixChanged} />
                  ))}
                </div>
              ) : null}
            </Box>
          ) : null}
        </>
      ) : null}
      {run.status === "error" ? <ErrorText>{run.error}</ErrorText> : null}
      {run.status === "stopped" ? <p className="text-[13px] text-ink-3">Dihentikan.</p> : null}
    </div>
  );
};

export const TicketDetail = ({
  ticket,
  runs,
  fixes,
  running,
  loading,
  onInvestigate,
  onStop,
  onFixChanged,
  onStatus,
}: {
  readonly ticket: Ticket;
  readonly runs: ReadonlyArray<RunView>;
  readonly fixes: ReadonlyArray<Fix>;
  readonly running: boolean;
  readonly loading: boolean;
  readonly onInvestigate: (question?: string) => void;
  readonly onStop: () => void;
  readonly onFixChanged: () => void;
  readonly onStatus: (status: Ticket["status"]) => void;
}) => {
  const [question, setQuestion] = useState("");
  const shownFixIds = new Set(runs.flatMap((r) => r.fixIds));
  const otherFixes = fixes.filter((f) => !shownFixIds.has(f.id));

  const ask = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || running) return;
    onInvestigate(question.trim());
    setQuestion("");
  };

  return (
    <Card className="flex min-h-0 flex-col">
      <header className="border-b border-line-2 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge tone={TICKET_STATUS[ticket.status].tone}>{TICKET_STATUS[ticket.status].label}</Badge>
            <span className="text-[12.5px] text-ink-3">
              {ticket.nurseName} · {ticket.unit} · {formatDateTime(ticket.createdAt)}
              {ticket.createdBy ? ` · dicatat ${ticket.createdBy}` : ""}
            </span>
          </div>
          <div className="flex gap-1">
            {running ? (
              <Button size="sm" variant="ghost" onClick={onStop}>
                <Square /> Hentikan
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onInvestigate()}>
                <RotateCw /> {runs.length ? "Selidiki ulang" : "Selidiki"}
              </Button>
            )}
            {ticket.status === "closed" ? (
              <Button size="sm" variant="ghost" onClick={() => onStatus("open")}>
                <CircleSlash /> Buka lagi
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onStatus("closed")}>
                <CheckCircle2 /> Tutup tiket
              </Button>
            )}
          </div>
        </div>
        <blockquote className="mt-3 border-l-[3px] border-teal pl-3 font-display text-[18px] leading-snug font-medium text-ink">
          “{ticket.complaint}”
        </blockquote>
      </header>

      <div className="flex-1 space-y-8 px-5 py-5">
        {loading ? <Spinner className="text-ink-3" /> : null}
        {!loading && runs.length === 0 ? (
          <p className="text-[13.5px] text-ink-2">
            Belum diselidiki.{" "}
            <Button variant="quiet" size="sm" className="px-0" onClick={() => onInvestigate()}>
              Mulai investigasi
            </Button>
          </p>
        ) : null}
        {runs.map((run, i) => (
          <RunSection key={run.key} run={run} first={i === 0} fixes={fixes} onFixChanged={onFixChanged} />
        ))}
        {otherFixes.length > 0 ? (
          <section className="space-y-3">
            <h3 className="eyebrow">Perbaikan lain untuk tiket ini</h3>
            {otherFixes.map((f) => (
              <FixCard key={f.id} fixId={f.id} onChanged={onFixChanged} />
            ))}
          </section>
        ) : null}
      </div>

      <form onSubmit={ask} className="sticky bottom-0 flex items-end gap-2 border-t border-line-2 bg-card/95 px-5 py-3 backdrop-blur">
        <Textarea
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) ask(e);
          }}
          placeholder="Pertanyaan lanjutan tentang tiket ini…"
          className="max-h-32 min-h-9 resize-none"
          disabled={running}
        />
        <Button type="submit" variant="primary" size="icon" aria-label="Kirim pertanyaan" disabled={running || !question.trim()}>
          <SendHorizontal />
        </Button>
      </form>
    </Card>
  );
};

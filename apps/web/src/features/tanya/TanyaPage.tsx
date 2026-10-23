/**
 * Tanya Data: a chat in the middle of the page. Answers stream in with the
 * AI's steps above them, and carry tables, charts and numbers (with their
 * SQL). Threads and favorites live in the sidebar.
 */
import { Collapsible } from "@base-ui/react/collapsible";
import type { FormDraft } from "@simrs/shared";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StreamingMarkdown } from "../../components/agent/Markdown.tsx";
import { PendingLine, pendingStep, StepList } from "../../components/agent/StepList.tsx";
import { DocumentCard } from "../../components/blocks/DocumentCard.tsx";
import { DraftCard } from "../../components/blocks/DraftCard.tsx";
import { OpenInKhanza } from "../../components/desktop/OpenInKhanza.tsx";
import { RenderBlockView } from "../../components/blocks/RenderBlockView.tsx";
import type { Health } from "../../components/layout/Sidebar.tsx";
import { ErrorText } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { formMentioned, noRawatIn, noRmIn, type KhanzaForm } from "../../lib/desktop.ts";
import type { RunView } from "../../lib/run.ts";
import { useApi } from "../../lib/useApi.ts";
import { bumpFavorites } from "../../stores/refresh.ts";
import { useTanya } from "../../stores/tanya.ts";
import { Composer } from "./Composer.tsx";

const EXAMPLES = [
  "Berapa pasien yang daftar hari ini?",
  "Jumlah kunjungan per poli 7 hari terakhir",
  "10 obat paling banyak dipakai minggu ini",
  "Pasien BPJS vs umum hari ini",
  "Rata-rata lama rawat inap per bangsal bulan lalu",
  "Buatkan riwayat pasien RM 000002",
];

/** Pixels from the bottom within which the chat keeps following new text. */
const FOLLOW_DISTANCE = 96;

const CopyButton = ({ text }: { readonly text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Tersalin" : "Salin jawaban"}
      title={copied ? "Tersalin" : "Salin jawaban"}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
};

/**
 * "Buka di Khanza" under an answer only when the answer is about a form Khanza has (resume, CPPT/SOAP,
 * riwayat) and names its visit or patient; not when the turn already shows a card with its own button.
 */
const khanzaButtonFor = (turn: RunView): { form: KhanzaForm; noRawat: string | null; noRm: string | null } | null => {
  if (turn.documents.length > 0 || turn.drafts.length > 0) return null;
  const form = formMentioned(turn.text);
  if (!form) return null;
  const inputs = JSON.stringify(turn.steps.map((s) => s.input));
  const noRawat = noRawatIn(turn.text, turn.question, inputs);
  const noRm = noRmIn(turn.text, turn.question, inputs);
  if (form === "riwayat" ? !noRawat && !noRm : !noRawat) return null;
  return { form, noRawat, noRm };
};

const Turn = ({ turn, drafts }: { readonly turn: RunView; readonly drafts: ReadonlyArray<FormDraft> }) => {
  const khanza = turn.status === "done" ? khanzaButtonFor(turn) : null;
  const running = turn.status === "running";
  // Steps are open while the AI works and fold away when the answer is in.
  const [stepsOpen, setStepsOpen] = useState(running);
  const [wasRunning, setWasRunning] = useState(running);
  if (wasRunning !== running) {
    setWasRunning(running);
    setStepsOpen(running);
  }
  return (
    <article className="space-y-4" data-testid="tanya-turn">
      <div className="ml-auto w-fit max-w-[85%] animate-rise rounded-3xl bg-paper-2 px-4 py-2.5 text-[14.5px] whitespace-pre-wrap text-ink">
        {turn.question}
      </div>

      {turn.steps.length > 0 ? (
        <Collapsible.Root open={stepsOpen} onOpenChange={setStepsOpen}>
          <Collapsible.Trigger className="group flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink">
            <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
            <span className={running ? "shimmer" : ""}>
              {turn.steps.length} langkah{turn.model ? ` · ${turn.model}` : ""}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Panel className="mt-3 rounded-2xl border border-line-2 bg-paper/50 p-4 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <StepList steps={turn.steps} pending={pendingStep(turn)} />
          </Collapsible.Panel>
        </Collapsible.Root>
      ) : running ? (
        <p className="text-[13px] text-ink-3">
          <PendingLine pending={{ label: "Memahami pertanyaan…", since: turn.waitingSince, reasoning: turn.reasoning }} />
        </p>
      ) : null}

      {turn.blocks.map((block) => (
        <div key={block.id} className="animate-rise">
          <RenderBlockView block={block} onSaved={bumpFavorites} />
        </div>
      ))}
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} />
      ))}
      {turn.documents.map((document) => (
        <div key={document.id} className="animate-rise">
          <DocumentCard document={document} />
        </div>
      ))}
      <StreamingMarkdown text={turn.text} streaming={running} className="text-[14.5px]" />
      {turn.status === "error" ? <ErrorText>{turn.error}</ErrorText> : null}
      {turn.status === "stopped" ? <p className="text-[13px] text-ink-3">Dihentikan.</p> : null}
      {turn.status === "done" && turn.text ? (
        <div className="-mt-2 flex animate-fade-in items-center gap-1.5">
          <CopyButton text={turn.text} />
          {khanza ? <OpenInKhanza noRawat={khanza.noRawat} noRm={khanza.noRm} defaultForm={khanza.form} /> : null}
        </div>
      ) : null}
    </article>
  );
};

const EmptyState = ({ onPick }: { readonly onPick: (question: string) => void }) => (
  <div className="mx-auto flex max-w-2xl flex-1 animate-fade-in flex-col items-center justify-center px-4 py-12 text-center">
    <img src="/favicon.svg" alt="" className="size-11 opacity-90" />
    <h1 className="mt-5 font-display text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">Mau cek data apa hari ini?</h1>
    <p className="mt-2 max-w-md text-[13.5px] text-ink-2">
      AI menulis query SELECT sendiri, menjalankannya dengan user read-only, lalu menampilkan hasilnya beserta SQL-nya.
    </p>
    <div className="stagger mt-8 flex flex-wrap justify-center gap-2">
      {EXAMPLES.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() => onPick(example)}
          className="rounded-full border border-line-2 bg-card px-3.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-ink-3/50 hover:bg-paper hover:text-ink"
        >
          {example}
        </button>
      ))}
    </div>
  </div>
);

export const TanyaPage = () => {
  const { c } = useSearch({ from: "/shell/tanya" });
  const navigate = useNavigate();
  const { turns, running, loading, error, ask, stop, open, conversationId } = useTanya();
  const health = useApi<Health>("/api/health");
  const [question, setQuestion] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    if (c && c !== conversationId) void open(c);
  }, [c, conversationId, open]);

  // Keep the newest text in view while it streams, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const onScroll = () => {
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_DISTANCE;
    };
    const observer = new ResizeObserver(() => {
      if (follow.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(inner);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  const submit = async (text = question) => {
    const q = text.trim();
    if (!q || running) return;
    setQuestion("");
    follow.current = true;
    const id = await ask(q);
    if (id && id !== c) void navigate({ to: "/tanya", search: { c: id }, replace: true });
  };

  // Each draft shows once, in the turn that made it, in its latest state (later turns may change it).
  const draftsByTurn = new Map<string, Array<FormDraft>>();
  const latest = new Map<string, FormDraft>();
  for (const t of turns) for (const d of t.drafts) latest.set(d.id, d);
  const placed = new Set<string>();
  for (const t of turns) {
    for (const d of t.drafts) {
      if (placed.has(d.id)) continue;
      placed.add(d.id);
      draftsByTurn.set(t.key, [...(draftsByTurn.get(t.key) ?? []), latest.get(d.id) ?? d]);
    }
  }
  const model = turns.findLast((t) => t.model)?.model ?? (health.data ? `${health.data.llm.provider} · ${health.data.llm.model}` : null);
  const empty = turns.length === 0 && !loading;

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="quiet-scroll min-h-0 flex-1 overflow-y-auto">
        <div ref={content} className="flex min-h-full flex-col">
          {empty ? (
            <EmptyState onPick={(q) => void submit(q)} />
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-10 px-4 pt-8 pb-10 sm:px-6">
              {loading ? <Spinner className="text-ink-3" /> : null}
              {turns.map((turn) => (
                <Turn key={turn.key} turn={turn} drafts={draftsByTurn.get(turn.key) ?? []} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
        <div className="mx-auto max-w-3xl">
          <ErrorText>{error}</ErrorText>
          <Composer
            value={question}
            onChange={setQuestion}
            onSubmit={() => void submit()}
            onStop={stop}
            running={running}
            model={model}
            placeholder={turns.length ? "Pertanyaan lanjutan, mis. “sekarang per bulan, 3 bulan terakhir”" : "Tanya apa saja tentang data rumah sakit…"}
          />
        </div>
      </div>
    </div>
  );
};

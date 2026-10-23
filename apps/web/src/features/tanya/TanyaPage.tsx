/**
 * Tanya Data: a chat in the middle, with the answer cards kept in the right
 * panel. Answers stream in with the AI's steps above them; the chat keeps a
 * one-line reference for each card (table, chart, document, draft, radiology)
 * and clicking it opens the full card beside the conversation. On a narrow
 * window the cards stay inline in the chat.
 */
import { Collapsible } from "@base-ui/react/collapsible";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, ChevronRight, Copy, FolderClosed, PanelRightOpen, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnswerFeedback } from "../../components/agent/AnswerFeedback.tsx";
import { StreamingMarkdown } from "../../components/agent/Markdown.tsx";
import { PendingLine, pendingStep, StepList } from "../../components/agent/StepList.tsx";
import { CardBody, CardIcon, CardsPanel } from "../../components/layout/CardsPanel.tsx";
import { OpenInKhanza } from "../../components/desktop/OpenInKhanza.tsx";
import type { Health } from "../../components/layout/Sidebar.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { ErrorText } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { rmFromSteps, rmFromText, splitAnswer } from "../../lib/answer.ts";
import { cardsFromTurns, cardsOfTurn, type AnswerCard } from "../../lib/cards.ts";
import { cn } from "../../lib/cn.ts";
import { formMentioned, noRawatIn, noRmIn, type KhanzaForm } from "../../lib/desktop.ts";
import type { RunView } from "../../lib/run.ts";
import { useApi } from "../../lib/useApi.ts";
import { useWideLayout } from "../../lib/useMediaQuery.ts";
import { useCardsPanel } from "../../stores/cards.ts";
import { bumpFavorites } from "../../stores/refresh.ts";
import { useTanya } from "../../stores/tanya.ts";
import { FixCard } from "../../components/agent/FixCard.tsx";
import { PatientPanel } from "../../components/patient/PatientPanel.tsx";
import { Composer } from "./Composer.tsx";

const INVESTIGATE_EXAMPLES = [
  "Pasien 2026/10/21/000067 tidak bisa dipulangkan",
  "Pasien RM 000002 tidak bisa dipindah ke kamar MAW-03",
  "Tindakan RJ001 tidak bisa dihapus di kunjungan 2026/10/01/000003",
];

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

/** A card lives in the panel; the chat shows this one-line door to it. */
const CardReference = ({ card, active }: { readonly card: AnswerCard; readonly active: boolean }) => {
  const select = useCardsPanel((s) => s.select);
  return (
    <button
      type="button"
      data-testid="card-reference"
      onClick={() => select(card.key)}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color] duration-150",
        active ? "border-teal/40 bg-teal-soft/20" : "border-line bg-card hover:border-ink-3/30 hover:bg-paper/40",
      )}
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", active ? "bg-teal-soft text-teal" : "bg-paper text-ink-2")}>
        <CardIcon card={card} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="rounded bg-paper px-1.5 py-px font-mono text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">{card.badge}</span>
          <span className="truncate text-[13px] font-medium text-ink">{card.label}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{card.summary}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-3 transition-colors group-hover:text-ink">
        Buka <PanelRightOpen className="size-3.5" />
      </span>
    </button>
  );
};

/**
 * "Buka di Khanza" under an answer only when the answer is about a form Khanza has (resume, CPPT/SOAP,
 * riwayat) and names its visit or patient; not when the turn already shows a card with its own button.
 */
const khanzaButtonFor = (turn: RunView): { form: KhanzaForm; noRawat: string | null; noRm: string | null } | null => {
  if (turn.documents.length > 0 || turn.drafts.length > 0 || turn.radiology.length > 0) return null;
  const form = formMentioned(turn.text);
  if (!form) return null;
  const inputs = JSON.stringify(turn.steps.map((s) => s.input));
  const noRawat = noRawatIn(turn.text, turn.question, inputs);
  const noRm = noRmIn(turn.text, turn.question, inputs);
  if (form === "riwayat" ? !noRawat && !noRm : !noRawat) return null;
  return { form, noRawat, noRm };
};

const Turn = ({
  turn,
  cards,
  wide,
  selectedKey,
}: {
  readonly turn: RunView;
  readonly cards: ReadonlyArray<AnswerCard>;
  readonly wide: boolean;
  readonly selectedKey: string | null;
}) => {
  const khanza = turn.status === "done" ? khanzaButtonFor(turn) : null;
  const running = turn.status === "running";
  // Text answers have no card to rate, so give them their own 👍/👎.
  const canRateAnswer = turn.status === "done" && turn.text !== "" && turn.runId !== null && turn.blocks.length === 0;
  // An investigation shows its checks; Tanya Data keeps them folded away.
  const [stepsOpen, setStepsOpen] = useState(turn.mode === "investigasi");
  const [patientOpen, setPatientOpen] = useState(false);
  const rm = rmFromSteps(turn.steps) ?? rmFromText(turn.question) ?? rmFromText(turn.text);
  const diagnosis = splitAnswer(turn.text).diagnosis;

  return (
    <article className="space-y-3.5" data-testid="tanya-turn">
      <div className="flex items-center justify-end gap-2">
        {turn.mode === "investigasi" ? (
          <span className="rounded-full border border-amber/30 bg-amber-soft/50 px-2 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.08em] text-amber uppercase">
            Investigasi
          </span>
        ) : null}
        <div className="max-w-[85%] animate-rise rounded-[20px] rounded-br-md bg-paper-2 px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
          {turn.question}
        </div>
      </div>

      {turn.steps.length > 0 ? (
        <Collapsible.Root open={stepsOpen} onOpenChange={setStepsOpen}>
          <Collapsible.Trigger className="group -ml-1 flex h-7 items-center gap-1.5 rounded-md px-1 text-[12px] text-ink-3 transition-colors hover:text-ink">
            <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
            <span className={running ? "shimmer" : ""}>
              {turn.steps.length} langkah{turn.model ? ` · ${turn.model}` : ""}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Panel className="mt-2 px-0.5 pt-1 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <StepList steps={turn.steps} pending={pendingStep(turn)} />
          </Collapsible.Panel>
        </Collapsible.Root>
      ) : running ? (
        <p className="text-[12.5px] text-ink-3">
          <PendingLine pending={{ label: "Memahami pertanyaan…", since: turn.waitingSince, reasoning: turn.reasoning }} />
        </p>
      ) : null}

      <StreamingMarkdown text={turn.text} streaming={running} className="text-[14px]" />

      {cards.length > 0 ? (
        wide ? (
          <div className="space-y-2" data-testid="card-references">
            {cards.map((card) => (
              <CardReference key={card.key} card={card} active={card.key === selectedKey} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {cards.map((card) => (
              <div key={card.key} className="animate-rise">
                <CardBody card={card} onSaved={bumpFavorites} />
              </div>
            ))}
          </div>
        )
      ) : null}

      {turn.status === "done" && (turn.stopReason === "time_budget" || turn.stopReason === "max_steps") ? (
        <p className="rounded-md border border-amber/25 bg-amber-soft/40 px-3 py-2 text-[12.5px] text-amber">
          Jawaban ini dibuat setelah batas waktu penyelidikan. Periksa data yang masih kurang sebelum mengambil keputusan.
        </p>
      ) : null}

      {turn.fixIds.length > 0 ? (
        <section className="space-y-3" data-testid="turn-fixes">
          <h3 className="eyebrow">Saran perbaikan data</h3>
          {turn.fixIds.map((fixId) => (
            <FixCard key={fixId} fixId={fixId} onChanged={() => undefined} />
          ))}
        </section>
      ) : null}

      {turn.status === "error" ? <ErrorText>{turn.error}</ErrorText> : null}
      {turn.status === "stopped" ? <p className="text-[12.5px] text-ink-3">Dihentikan.</p> : null}
      {turn.status === "done" && turn.text ? (
        <div className="flex animate-fade-in flex-wrap items-center gap-1.5">
          <CopyButton text={turn.text} />
          {canRateAnswer && turn.runId !== null ? <AnswerFeedback runId={turn.runId} /> : null}
          {rm ? (
            <button
              type="button"
              onClick={() => setPatientOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              <UserRound className="size-3.5" /> Kartu pasien
            </button>
          ) : null}
          {khanza ? <OpenInKhanza noRawat={khanza.noRawat} noRm={khanza.noRm} defaultForm={khanza.form} /> : null}
        </div>
      ) : null}

      <Dialog
        open={patientOpen}
        onOpenChange={setPatientOpen}
        wide
        title="Kartu pasien"
        description={rm ? `RM ${rm}` : undefined}
      >
        <PatientPanel rm={rm} summary={diagnosis} />
      </Dialog>
    </article>
  );
};

const EmptyState = ({
  composer,
  error,
  readOnly,
  mode,
  onPick,
}: {
  readonly composer: ReactNode;
  readonly error: string | null;
  readonly readOnly: boolean | undefined;
  readonly mode: "tanya" | "investigasi";
  readonly onPick: (question: string) => void;
}) => (
  <div className="mx-auto flex w-full max-w-[800px] flex-1 animate-fade-in flex-col justify-center px-4 py-10 sm:px-6">
    <div className="mb-7 flex flex-col items-center text-center">
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <img src="/favicon.svg" alt="" className="size-8 opacity-95" />
        <h1 className="font-display text-[26px] leading-tight font-semibold tracking-[-0.025em] sm:text-[31px]">
          {mode === "investigasi" ? "Keluhan apa yang mau diselidiki?" : "Mau cek data apa hari ini?"}
        </h1>
        <span className="hidden rounded-full border border-teal/20 bg-teal-soft px-2 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.08em] text-teal uppercase sm:inline">
          AI
        </span>
      </div>
      <p className="mt-2.5 max-w-md text-[13px] leading-relaxed text-ink-2">
        {mode === "investigasi"
          ? "Tempel keluhan perawat. AI memeriksa data Khanza, mencari penyebabnya, dan mengusulkan perbaikan yang harus disetujui dulu."
          : "Tanya apa saja tentang data rumah sakit. AI menulis query SELECT sendiri, menjalankannya dengan user read-only, lalu menampilkan hasilnya beserta SQL-nya."}
      </p>
    </div>

    <div className="mx-auto w-full max-w-[720px]">
      <div className="mb-2 flex items-center gap-1 px-1">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-ink-2">
          <FolderClosed className="size-3.5 text-ink-3" /> SIMRS Khanza
        </span>
        <span className="text-[11px] text-line">/</span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-ink-2">
          <ShieldCheck className="size-3.5 text-ink-3" /> {readOnly === false ? "Bisa menulis" : "Read-only"}
        </span>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {composer}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
        {(mode === "investigasi" ? INVESTIGATE_EXAMPLES : EXAMPLES.slice(0, 3)).map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-ink-3/40 hover:bg-paper hover:text-ink"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  </div>
);

export const TanyaPage = () => {
  const { c } = useSearch({ from: "/shell/tanya" });
  const navigate = useNavigate();
  const { turns, running, loading, error, mode, setMode, ask, stop, open, conversationId } = useTanya();
  const health = useApi<Health>("/api/health");
  const [question, setQuestion] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  const cards = useMemo(() => cardsFromTurns(turns), [turns]);
  const wide = useWideLayout();
  const panelOpen = useCardsPanel((s) => s.open);
  const selectedId = useCardsPanel((s) => s.selectedId);
  const setPanelOpen = useCardsPanel((s) => s.setOpen);
  const select = useCardsPanel((s) => s.select);
  const newestKey = cards.at(-1)?.key ?? null;
  const lastAuto = useRef<string | null>(null);

  useEffect(() => {
    if (c && c !== conversationId) void open(c);
  }, [c, conversationId, open]);

  // A card from a live answer opens the panel on its own. Cards restored from a
  // stored conversation do not: the panel starts closed and waits to be opened.
  useEffect(() => {
    if (!newestKey) {
      lastAuto.current = null;
      setPanelOpen(false);
      return;
    }
    if (lastAuto.current === newestKey) return;
    lastAuto.current = newestKey;
    if (running) select(newestKey);
  }, [newestKey, running, select, setPanelOpen]);

  // ⇧⌘K (Ctrl+Shift+K) collapses or reopens the card panel, when there is a card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!wide || cards.length === 0 || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      useCardsPanel.getState().toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, cards.length]);

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

  const fullModel = turns.findLast((t) => t.model)?.model ?? (health.data ? `${health.data.llm.provider} · ${health.data.llm.model}` : null);
  const model = fullModel ? (fullModel.split(" · ").at(-1) ?? fullModel) : null;
  const readOnly = health.data?.khanza.readOnly;
  const empty = turns.length === 0 && !loading;
  const selectedKey = selectedId ?? newestKey;

  const composer = (
    <Composer
      value={question}
      onChange={setQuestion}
      onSubmit={() => void submit()}
      onStop={stop}
      running={running}
      model={model}
      readOnly={readOnly}
      examples={mode === "investigasi" ? INVESTIGATE_EXAMPLES : EXAMPLES}
      mode={mode}
      onModeChange={setMode}
      placeholder={
        mode === "investigasi"
          ? "Tempel keluhan perawat, mis. “Pasien RM 000002 tidak bisa dipindah ke kamar MAW-03”…"
          : turns.length
            ? "Pertanyaan lanjutan, mis. “sekarang per bulan, 3 bulan terakhir”"
            : "Tanya apa saja tentang data rumah sakit…"
      }
    />
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div ref={scroller} className="quiet-scroll min-h-0 flex-1 overflow-y-auto">
          <div ref={content} className="flex min-h-full flex-col">
            {empty ? (
              <EmptyState composer={composer} error={error} readOnly={readOnly} mode={mode} onPick={(q) => void submit(q)} />
            ) : (
              <div className="mx-auto w-full max-w-[800px] space-y-9 px-4 pt-12 pb-10 sm:px-8">
                {loading ? <Spinner className="text-ink-3" /> : null}
                {turns.map((turn) => (
                  <Turn key={turn.key} turn={turn} cards={cardsOfTurn(cards, turn.key)} wide={wide} selectedKey={selectedKey} />
                ))}
              </div>
            )}
          </div>
        </div>

        {empty ? null : (
          <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
            <div className="mx-auto max-w-[800px]">
              {error ? <ErrorText>{error}</ErrorText> : null}
              {composer}
              <p className="mt-2 text-center text-[10.5px] text-ink-3">Enter untuk kirim · Shift+Enter baris baru</p>
            </div>
          </div>
        )}

        {wide && !panelOpen && cards.length > 0 ? (
          <div className="pointer-events-none absolute top-3 right-3 z-10">
            <button
              type="button"
              aria-label="Buka panel kartu"
              title="Buka panel kartu"
              onClick={() => setPanelOpen(true)}
              className="pointer-events-auto relative grid size-8 animate-fade-in place-items-center rounded-full border border-line bg-card/95 text-ink-2 backdrop-blur transition-colors hover:bg-paper hover:text-ink"
            >
              <PanelRightOpen className="size-4" />
              <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 font-mono text-[9px] text-paper">{cards.length}</span>
            </button>
          </div>
        ) : null}
      </div>

      {wide && panelOpen && cards.length > 0 ? <CardsPanel cards={cards} onSaved={bumpFavorites} /> : null}
    </div>
  );
};

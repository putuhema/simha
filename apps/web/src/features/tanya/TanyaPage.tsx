/**
 * Tanya Data: a full-width chat where answers carry tables, charts and
 * numbers (with their SQL), plus saved favorites and recent threads.
 */
import type { ConversationSummary, Favorite, RenderBlock } from "@simrs/shared";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { History, MessageSquarePlus, Play, SendHorizontal, Square, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Markdown } from "../../components/agent/Markdown.tsx";
import { PendingLine, pendingStep, StepList } from "../../components/agent/StepList.tsx";
import { DocumentCard } from "../../components/blocks/DocumentCard.tsx";
import { RenderBlockView } from "../../components/blocks/RenderBlockView.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { ErrorText, Textarea } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatRelative } from "../../lib/format.ts";
import type { RunView } from "../../lib/run.ts";
import { useApi } from "../../lib/useApi.ts";
import { useTanya } from "../../stores/tanya.ts";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";

const EXAMPLES = [
  "Berapa pasien yang daftar hari ini?",
  "Buatkan riwayat pasien RM 000002",
  "10 obat paling banyak dipakai minggu ini",
  "Jumlah kunjungan per poli 7 hari terakhir",
  "Pasien BPJS vs umum hari ini",
  "Rata-rata lama rawat inap per bangsal bulan lalu",
];

const Turn = ({ turn, onSaved }: { readonly turn: RunView; readonly onSaved: () => void }) => (
  <article className="space-y-3" data-testid="tanya-turn">
    <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-teal-2 px-3.5 py-2 text-[14px] text-paper">{turn.question}</div>
    {turn.steps.length > 0 ? (
      <Collapsible.Root defaultOpen={turn.status === "running"}>
        <Collapsible.Trigger className="group flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
          <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
          {turn.status === "running" ? <Spinner className="size-3" /> : null}
          {turn.steps.length} langkah{turn.model ? ` · ${turn.model}` : ""}
        </Collapsible.Trigger>
        <Collapsible.Panel className="mt-3 rounded-lg border border-line-2 bg-card/70 p-3">
          <StepList steps={turn.steps} pending={pendingStep(turn)} />
        </Collapsible.Panel>
      </Collapsible.Root>
    ) : turn.status === "running" ? (
      <p className="flex items-start gap-2 text-[13px] text-ink-3">
        <Spinner /> <PendingLine pending={{ label: "Memahami pertanyaan…", since: turn.waitingSince, reasoning: turn.reasoning }} />
      </p>
    ) : null}
    {turn.blocks.map((block) => (
      <RenderBlockView key={block.id} block={block} onSaved={onSaved} />
    ))}
    {turn.documents.map((document) => (
      <DocumentCard key={document.id} document={document} />
    ))}
    {turn.text ? <Markdown text={turn.text} className={turn.status === "running" ? "text-ink-2" : ""} /> : null}
    {turn.status === "error" ? <ErrorText>{turn.error}</ErrorText> : null}
    {turn.status === "stopped" ? <p className="text-[13px] text-ink-3">Dihentikan.</p> : null}
  </article>
);

const Favorites = ({ favorites, onRun, onDelete }: { readonly favorites: ReadonlyArray<Favorite> | undefined; readonly onRun: (f: Favorite) => void; readonly onDelete: (f: Favorite) => void }) => (
  <Panel title="Pertanyaan favorit" bodyClassName="p-0">
    {favorites === undefined ? (
      <div className="p-4">
        <Spinner className="text-ink-3" />
      </div>
    ) : favorites.length === 0 ? (
      <p className="p-4 text-[13px] text-ink-3">Belum ada. Klik “Simpan ke favorit” di bawah hasil untuk menyimpan pertanyaan beserta query-nya.</p>
    ) : (
      <ul data-testid="favorites">
        {favorites.map((f) => (
          <li key={f.id} className="group flex items-start gap-1 border-b border-line-2 px-3 py-2 last:border-0">
            <button type="button" onClick={() => onRun(f)} className="min-w-0 flex-1 text-left" title="Jalankan lagi tanpa AI">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                <Star className="size-3.5 shrink-0 fill-amber text-amber" />
                <span className="truncate">{f.judul}</span>
              </p>
              <p className="truncate text-[12px] text-ink-3">{f.question}</p>
            </button>
            <Button size="icon" variant="ghost" className="size-7" aria-label="Jalankan" onClick={() => onRun(f)}>
              <Play />
            </Button>
            <Button size="icon" variant="ghost" className="size-7 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Hapus favorit" onClick={() => onDelete(f)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    )}
  </Panel>
);

export const TanyaPage = () => {
  const { c } = useSearch({ from: "/shell/tanya" });
  const navigate = useNavigate();
  const { turns, running, loading, error, ask, stop, open, reset, showFavorite, conversationId } = useTanya();
  const favorites = useApi<ReadonlyArray<Favorite>>("/api/favorites");
  const history = useApi<ReadonlyArray<ConversationSummary>>("/api/conversations?mine=1");
  const [question, setQuestion] = useState("");
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (c && c !== conversationId) void open(c);
  }, [c, conversationId, open]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, running]);

  const submit = async (event?: FormEvent, text = question) => {
    event?.preventDefault();
    const q = text.trim();
    if (!q || running) return;
    setQuestion("");
    const id = await ask(q);
    if (id && id !== c) void navigate({ to: "/tanya", search: { c: id }, replace: true });
    void history.reload();
  };

  const runFavorite = async (favorite: Favorite) => {
    setFavoriteError(null);
    try {
      const { block } = await api.post<{ block: RenderBlock }>(`/api/favorites/${favorite.id}/run`);
      showFavorite(favorite.question, block);
    } catch (e) {
      setFavoriteError(errorMessage(e));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex min-h-[calc(100vh-14rem)] flex-col rounded-lg border border-line bg-card/80">
        <div className="flex items-center justify-between border-b border-line-2 px-4 py-2.5">
          <h2 className="eyebrow">Tanya Data</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Clear ?c= first, or the old thread would be reopened from the URL.
              void navigate({ to: "/tanya", search: {} }).then(reset);
            }}
          >
            <MessageSquarePlus /> Percakapan baru
          </Button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-4 py-5 sm:px-8">
          {loading ? <Spinner className="text-ink-3" /> : null}
          <ErrorText>{error ?? favoriteError}</ErrorText>
          {turns.length === 0 && !loading ? (
            <div className="mx-auto max-w-xl py-10 text-center">
              <p className="font-display text-[26px] leading-tight font-semibold tracking-tight">Tanya apa saja tentang data rumah sakit.</p>
              <p className="mt-2 text-[13.5px] text-ink-2">
                AI menulis query SELECT sendiri, menjalankannya dengan user read-only, lalu menampilkan hasilnya beserta SQL-nya.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void submit(undefined, example)}
                    className="rounded-full border border-line bg-card px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-teal hover:text-teal"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {turns.map((turn) => (
            <Turn key={turn.key} turn={turn} onSaved={() => void favorites.reload()} />
          ))}
          <div ref={end} />
        </div>

        <form onSubmit={(e) => void submit(e)} className="sticky bottom-0 flex items-end gap-2 border-t border-line-2 bg-card/95 px-4 py-3 backdrop-blur">
          <Textarea
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) void submit(e);
            }}
            placeholder={turns.length ? "Pertanyaan lanjutan, mis. “sekarang per bulan, 3 bulan terakhir”" : "Tulis pertanyaan…"}
            className="max-h-40 min-h-10 resize-none text-[14.5px]"
            aria-label="Pertanyaan"
          />
          {running ? (
            <Button variant="outline" size="icon" aria-label="Hentikan" onClick={stop} className="size-10">
              <Square />
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="icon" aria-label="Kirim" disabled={!question.trim()} className="size-10">
              <SendHorizontal />
            </Button>
          )}
        </form>
      </section>

      <aside className="flex flex-col gap-4">
        <Favorites
          favorites={favorites.data}
          onRun={(f) => void runFavorite(f)}
          onDelete={(f) => void api.delete(`/api/favorites/${f.id}`).then(() => favorites.reload())}
        />
        <Panel title="Percakapan saya" bodyClassName="p-0">
          {history.data && history.data.length > 0 ? (
            <ul>
              {history.data.slice(0, 15).map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => void navigate({ to: "/tanya", search: { c: h.id } })}
                    className={`w-full border-b border-line-2 px-3 py-2 text-left hover:bg-paper ${h.id === conversationId ? "bg-teal-soft/50" : ""}`}
                  >
                    <p className="flex items-center gap-1.5 truncate text-[13px]">
                      <History className="size-3.5 shrink-0 text-ink-3" />
                      <span className="truncate">{h.firstQuestion}</span>
                    </p>
                    <p className="pl-5 font-mono text-[11px] text-ink-3">
                      {h.runCount} pertanyaan · {formatRelative(h.lastAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[13px] text-ink-3">Belum ada percakapan.</p>
          )}
        </Panel>
      </aside>
    </div>
  );
};

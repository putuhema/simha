/**
 * The right panel: the answer cards of the current thread. While the chat
 * keeps a one-line reference for each card, the full table, chart, document,
 * draft or radiology card stays here, one at a time, with a strip of tabs.
 * With no cards yet it is the "start" panel, like a quiet desk.
 */
import { ChartColumn, FilePenLine, FileText, FolderOpen, Maximize2, PanelRightClose, ScanLine, Table2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AnswerCard } from "../../lib/cards.ts";
import { cn } from "../../lib/cn.ts";
import { useCardsPanel } from "../../stores/cards.ts";
import { BerkasDigitalCard } from "../berkas/BerkasDigitalCard.tsx";
import { DocumentCard } from "../blocks/DocumentCard.tsx";
import { DraftCard } from "../blocks/DraftCard.tsx";
import { RenderBlockView } from "../blocks/RenderBlockView.tsx";
import { RadiologyCard } from "../pacs/Radiology.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TipButton } from "../ui/Tip.tsx";

const WIDTH_KEY = "simha.cards-width";
const MIN_WIDTH = 360;
const MAX_WIDTH = 680;
const DEFAULT_WIDTH = 420;

const panelRoom = () => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 720));
const clampWidth = (next: number) => Math.min(panelRoom(), Math.max(MIN_WIDTH, next));

const savedWidth = () => {
  try {
    const stored = Number(globalThis.localStorage?.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? Math.min(stored, MAX_WIDTH) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
};

const ICON = {
  table: Table2,
  bar: ChartColumn,
  line: ChartColumn,
  pie: ChartColumn,
  stat: ChartColumn,
  list: Table2,
  document: FileText,
  draft: FilePenLine,
  radiology: ScanLine,
  berkas: FolderOpen,
} as const;

export const CardIcon = ({ card, className }: { readonly card: AnswerCard; readonly className?: string }) => {
  const Icon = card.kind === "render" ? ICON[card.block.tipe] : ICON[card.kind];
  return <Icon className={className} aria-hidden />;
};

export const CardBody = ({
  card,
  onSaved,
  fill,
  documentHeight,
  flat,
}: {
  readonly card: AnswerCard;
  readonly onSaved?: (() => void) | undefined;
  readonly fill?: boolean | undefined;
  readonly documentHeight?: number | undefined;
  /** No card chrome: the panel's own background shows through (used in the cards panel). */
  readonly flat?: boolean | undefined;
}) => {
  switch (card.kind) {
    case "render":
      return <RenderBlockView block={card.block} compact onSaved={onSaved} flat={flat} />;
    case "document":
      return <DocumentCard document={card.document} fill={fill} height={documentHeight ?? 520} flat={flat} />;
    case "draft":
      return <DraftCard draft={card.draft} fill={fill} flat={flat} />;
    case "radiology":
      return <RadiologyCard gallery={card.radiology} flat={flat} />;
    case "berkas":
      return <BerkasDigitalCard berkas={card.berkas} flat={flat} />;
  }
};

export const CardsPanel = ({ cards, onSaved }: { readonly cards: ReadonlyArray<AnswerCard>; readonly onSaved?: (() => void) | undefined }) => {
  const { selectedId, select, setOpen } = useCardsPanel();
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(() => clampWidth(savedWidth()));
  const selected = cards.find((card) => card.key === selectedId) ?? cards.at(-1) ?? null;
  const autoSized = useRef<string | null>(null);

  // Give a document or a draft room to be read the first time it opens.
  useEffect(() => {
    if (!selected || autoSized.current === selected.key) return;
    autoSized.current = selected.key;
    const wanted = selected.kind === "document" ? 620 : selected.kind === "draft" ? 480 : 0;
    if (wanted === 0) return;
    setWidth((current) => Math.max(current, Math.min(wanted, panelRoom())));
  }, [selected]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(WIDTH_KEY, String(width));
    } catch {
      // Private mode: just do not remember the width.
    }
  }, [width]);

  // The panel must leave room for the chat when the window shrinks.
  useEffect(() => {
    const onResize = () => setWidth((current) => clampWidth(current));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => setWidth(clampWidth(startWidth - (moveEvent.clientX - startX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // The panel only exists while there is a card to show.
  if (cards.length === 0) return null;

  return (
    <aside
      aria-label="Panel kartu"
      style={{ width }}
      className="relative flex h-full shrink-0 animate-panel-in flex-col border-l border-line-2 bg-card"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Atur lebar panel kartu"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={panelRoom()}
        title="Tarik untuk mengubah lebar panel"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setWidth((current) => clampWidth(current + (event.key === "ArrowLeft" ? 24 : -24)));
        }}
        className="group absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize rounded-full"
      >
        <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-teal/40" />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-line-2 py-2 pr-2">
        <div className="quiet-scroll min-w-0 flex-1 overflow-x-auto px-2">
          <div className="flex w-max items-center gap-1.5">
            {cards.map((card) => {
              const active = card.key === selected?.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => select(card.key)}
                  title={`${card.badge} · ${card.label}`}
                  className={cn(
                    "flex h-7 max-w-[190px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors",
                    active ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-2 hover:bg-paper",
                  )}
                >
                  <CardIcon card={card} className="size-3.5 shrink-0" />
                  <span className="truncate">{card.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {selected ? (
            <TipButton label="Perbesar kartu" onClick={() => setExpanded(true)} className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink">
              <Maximize2 className="size-3.5" />
            </TipButton>
          ) : null}
          <TipButton
            label="Sembunyikan panel"
            shortcut="⇧⌘K"
            onClick={() => setOpen(false)}
            className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <PanelRightClose className="size-4" />
          </TipButton>
        </div>
      </div>

      {selected ? (
        <div className="min-h-0 flex-1">
          {selected.kind === "document" || selected.kind === "draft" ? (
            <div className="h-full min-h-0 p-2">
              <CardBody card={selected} onSaved={onSaved} fill flat />
            </div>
          ) : (
            <div className="quiet-scroll h-full overflow-y-auto p-3" data-testid="cards-panel-body">
              <CardBody card={selected} onSaved={onSaved} flat />
            </div>
          )}
        </div>
      ) : null}

      <Dialog open={expanded && selected !== null} onOpenChange={(open) => !open && setExpanded(false)} title={selected?.label ?? "Kartu"} description={selected?.summary} wide>
        <div className="max-h-[76vh] overflow-y-auto">
          {selected ? <CardBody card={selected} onSaved={onSaved} documentHeight={640} /> : null}
        </div>
      </Dialog>
    </aside>
  );
};

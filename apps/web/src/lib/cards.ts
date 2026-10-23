/**
 * Cards are the parts of an answer that are worth keeping in view: a table
 * or chart, a printable patient document, an editable form draft, or
 * radiology images. The chat shows a one-line reference for each; the card
 * itself opens in the right panel.
 */
import { FORM_TITLES, type DocumentInfo, type FormDraft, type RadiologyGallery, type RenderBlock } from "@simha/shared";
import type { RunView } from "./run.ts";

export const RENDER_TYPE_LABEL: Readonly<Record<RenderBlock["tipe"], string>> = {
  table: "Tabel",
  bar: "Grafik batang",
  line: "Grafik garis",
  pie: "Grafik pai",
  stat: "Angka",
  list: "Daftar",
};

const DOCUMENT_KIND_LABEL: Readonly<Record<DocumentInfo["jenis"], string>> = {
  riwayat: "Riwayat",
  cppt: "CPPT / SOAP",
  resume: "Resume",
};

interface CardBase {
  /** Stable across a live run and its stored transcript. */
  readonly key: string;
  readonly id: string;
  readonly turnKey: string;
  readonly question: string;
  readonly at: string;
  readonly label: string;
  readonly badge: string;
  readonly summary: string;
}

export type AnswerCard =
  | (CardBase & { readonly kind: "render"; readonly block: RenderBlock })
  | (CardBase & { readonly kind: "document"; readonly document: DocumentInfo })
  | (CardBase & { readonly kind: "draft"; readonly draft: FormDraft })
  | (CardBase & { readonly kind: "radiology"; readonly radiology: RadiologyGallery });

const cardKey = (kind: AnswerCard["kind"], id: string) => `${kind}:${id}`;

const renderSummary = (block: RenderBlock) => {
  if (block.tipe === "stat") return block.satuan ? `Angka · ${block.satuan}` : "Angka ringkas";
  if (block.tipe === "list") return `${block.baris.length} baris daftar`;
  return `${block.baris.length} baris${block.terpotong ? " (dipotong)" : ""}`;
};

const radiologySummary = (gallery: RadiologyGallery) =>
  `RM ${gallery.noRkmMedis}${gallery.noRawat ? ` · ${gallery.noRawat}` : ""}`;

/**
 * Every card of a conversation in reading order, with one entry per card:
 * a draft edited by a later turn keeps its first position but shows its
 * latest state (the same rule the chat uses for drafts).
 */
export const cardsFromTurns = (turns: ReadonlyArray<RunView>): ReadonlyArray<AnswerCard> => {
  const latestDraft = new Map<string, FormDraft>();
  const draftTurn = new Map<string, string>();
  for (const turn of turns) {
    for (const draft of turn.drafts) {
      latestDraft.set(draft.id, draft);
      if (!draftTurn.has(draft.id)) draftTurn.set(draft.id, turn.key);
    }
  }

  const cards: Array<AnswerCard> = [];
  const seen = new Set<string>();
  const add = (card: AnswerCard) => {
    if (seen.has(card.key)) return;
    seen.add(card.key);
    cards.push(card);
  };

  for (const turn of turns) {
    for (const block of turn.blocks) {
      add({
        kind: "render",
        key: cardKey("render", block.id),
        id: block.id,
        turnKey: turn.key,
        question: turn.question,
        at: turn.at,
        label: block.judul,
        badge: RENDER_TYPE_LABEL[block.tipe],
        summary: renderSummary(block),
        block,
      });
    }
    for (const draft of turn.drafts) {
      if (draftTurn.get(draft.id) !== turn.key) continue;
      const latest = latestDraft.get(draft.id) ?? draft;
      add({
        kind: "draft",
        key: cardKey("draft", draft.id),
        id: draft.id,
        turnKey: turn.key,
        question: turn.question,
        at: turn.at,
        label: FORM_TITLES[latest.form],
        badge: "Draf",
        summary: latest.subjek,
        draft: latest,
      });
    }
    for (const document of turn.documents) {
      add({
        kind: "document",
        key: cardKey("document", document.id),
        id: document.id,
        turnKey: turn.key,
        question: turn.question,
        at: turn.at,
        label: document.judul,
        badge: DOCUMENT_KIND_LABEL[document.jenis],
        summary: document.ringkas,
        document,
      });
    }
    turn.radiology.forEach((gallery, index) => {
      const id = `${turn.key}:radiologi:${index}`;
      add({
        kind: "radiology",
        key: cardKey("radiology", id),
        id,
        turnKey: turn.key,
        question: turn.question,
        at: turn.at,
        label: "Hasil radiologi",
        badge: "Radiologi",
        summary: radiologySummary(gallery),
        radiology: gallery,
      });
    });
  }
  return cards;
};

/** The cards made by one turn, in order. */
export const cardsOfTurn = (cards: ReadonlyArray<AnswerCard>, turnKey: string) => cards.filter((card) => card.turnKey === turnKey);

/**
 * Cards are the parts of an answer that are worth keeping in view: a table
 * or chart, a printable patient document, an editable form draft, or
 * radiology images. The chat shows a one-line reference for each; the card
 * itself opens in the right panel.
 */
import { FORM_TITLES, type BerkasDigital, type DocumentInfo, type FormDraft, type RadiologyGallery, type RenderBlock } from "@simha/shared";
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
  | (CardBase & { readonly kind: "radiology"; readonly radiology: RadiologyGallery })
  | (CardBase & { readonly kind: "berkas"; readonly berkas: BerkasDigital });

const cardKey = (kind: AnswerCard["kind"], id: string) => `${kind}:${id}`;

const renderSummary = (block: RenderBlock) => {
  if (block.tipe === "stat") return block.satuan ? `Angka · ${block.satuan}` : "Angka ringkas";
  if (block.tipe === "list") return `${block.baris.length} baris daftar`;
  return `${block.baris.length} baris${block.terpotong ? " (dipotong)" : ""}`;
};

const radiologySummary = (gallery: RadiologyGallery) =>
  `RM ${gallery.noRkmMedis}${gallery.noRawat ? ` · ${gallery.noRawat}` : ""}`;

interface DraftOwner {
  /** The first turn that showed the draft; later turns only update it. */
  readonly turnKey: string;
  readonly latest: FormDraft;
}

/** Each draft's first turn and latest state, which is what a draft card shows. */
const draftOwners = (turns: ReadonlyArray<RunView>): ReadonlyMap<string, DraftOwner> => {
  const owners = new Map<string, DraftOwner>();
  for (const turn of turns) {
    for (const draft of turn.drafts) owners.set(draft.id, { turnKey: owners.get(draft.id)?.turnKey ?? turn.key, latest: draft });
  }
  return owners;
};

/** The latest state of the drafts this turn introduced, in the turn's own order. */
const ownedDrafts = (turn: RunView, owners: ReadonlyMap<string, DraftOwner>): ReadonlyArray<FormDraft> => {
  const drafts: Array<FormDraft> = [];
  for (const draft of turn.drafts) {
    const owner = owners.get(draft.id);
    if (owner?.turnKey === turn.key) drafts.push(owner.latest);
  }
  return drafts;
};

const sameDrafts = (left: ReadonlyArray<FormDraft>, right: ReadonlyArray<FormDraft>) =>
  left.length === right.length && left.every((draft, index) => draft === right[index]);

/**
 * A turn's cards only change when that turn changes, or when a later turn updates
 * one of its drafts. Cached by turn object so a memoized `Turn` keeps the same
 * `cards` array (and skips re-rendering) while another turn streams.
 */
const turnCards = new WeakMap<RunView, { readonly drafts: ReadonlyArray<FormDraft>; readonly cards: ReadonlyArray<AnswerCard> }>();

const buildTurnCards = (turn: RunView, drafts: ReadonlyArray<FormDraft>): ReadonlyArray<AnswerCard> => {
  const cards: Array<AnswerCard> = [];
  const seen = new Set<string>();
  const add = (card: AnswerCard) => {
    if (seen.has(card.key)) return;
    seen.add(card.key);
    cards.push(card);
  };

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
  for (const draft of drafts) {
    add({
      kind: "draft",
      key: cardKey("draft", draft.id),
      id: draft.id,
      turnKey: turn.key,
      question: turn.question,
      at: turn.at,
      label: FORM_TITLES[draft.form],
      badge: "Draf",
      summary: draft.subjek,
      draft,
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
  for (const [index, gallery] of turn.radiology.entries()) {
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
  }
  for (const [index, berkas] of turn.berkas.entries()) {
    const id = `${turn.key}:berkas:${index}`;
    add({
      kind: "berkas",
      key: cardKey("berkas", id),
      id,
      turnKey: turn.key,
      question: turn.question,
      at: turn.at,
      label: "Berkas digital",
      badge: "Berkas",
      summary: `${berkas.berkas.length} berkas · ${berkas.subjek}`,
      berkas,
    });
  }
  return cards;
};

/**
 * The cards made by one turn, in order. The returned array keeps its identity
 * while the turn and its drafts are unchanged.
 */
const cardsOfTurn = (turn: RunView, owners: ReadonlyMap<string, DraftOwner>): ReadonlyArray<AnswerCard> => {
  const drafts = ownedDrafts(turn, owners);
  const cached = turnCards.get(turn);
  if (cached && sameDrafts(cached.drafts, drafts)) return cached.cards;
  const cards = buildTurnCards(turn, drafts);
  turnCards.set(turn, { drafts, cards });
  return cards;
};

/** Each turn's own cards, so the chat can pass a stable array to every `Turn`. */
export const cardsByTurn = (turns: ReadonlyArray<RunView>): ReadonlyMap<string, ReadonlyArray<AnswerCard>> => {
  const owners = draftOwners(turns);
  const byTurn = new Map<string, ReadonlyArray<AnswerCard>>();
  for (const turn of turns) byTurn.set(turn.key, cardsOfTurn(turn, owners));
  return byTurn;
};

/**
 * Every card of a conversation in reading order, with one entry per card:
 * a draft edited by a later turn keeps its first position but shows its
 * latest state (the same rule the chat uses for drafts).
 */
export const cardsFromTurns = (turns: ReadonlyArray<RunView>): ReadonlyArray<AnswerCard> => {
  const owners = draftOwners(turns);
  const cards: Array<AnswerCard> = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    for (const card of cardsOfTurn(turn, owners)) {
      if (seen.has(card.key)) continue;
      seen.add(card.key);
      cards.push(card);
    }
  }
  return cards;
};

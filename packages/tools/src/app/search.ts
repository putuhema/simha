/**
 * Keyword search over the generated app map. No embeddings: a query is
 * normalised, exact label/form matches count most, and a hand-written synonym
 * list covers the words staff use that never appear as a menu label
 * ("pindah kamar", "SEP", "batal registrasi").
 */
import type { AppDocsService, AppFlow, AppForm, AppMenu, AppRight, AppSynonym } from "./AppDocs.ts";

export type AppScope = "semua" | "menu" | "alur" | "form" | "hak" | "tabel";

interface ShortcutHit {
  readonly kind: "toolbar" | "klik-kanan";
  /** The item itself: "Billing/Pembayaran Pasien" or "Input Resep Pulang". */
  readonly label: string;
  /** Full right-click path ("Obat → Input Resep Pulang"). */
  readonly path: string;
  /** Dialog it belongs to, when known. */
  readonly form: AppForm | null;
}

export interface AppSearchResult {
  readonly menus: ReadonlyArray<AppMenu>;
  readonly flows: ReadonlyArray<AppFlow>;
  readonly forms: ReadonlyArray<AppForm>;
  readonly rights: ReadonlyArray<AppRight>;
  readonly synonyms: ReadonlyArray<AppSynonym>;
  readonly shortcuts: ReadonlyArray<ShortcutHit>;
}

/** Question words that say nothing about which menu/flow is meant. */
const STOPWORDS = new Set([
  "alur", "flow", "proses", "cara", "langkah", "menu", "bagian", "yang", "untuk", "dan", "atau",
  "dengan", "dari", "mana", "dimana", "apa", "itu", "ini", "bagaimana", "gimana", "please", "the",
  "hak", "akses", "di", "ke", "pada", "dalam", "buat", "soal",
]);

const norm = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9_]+/g, " ").trim();
const tokens = (text: string) =>
  [...new Set(norm(text).split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w)))];

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `needle` starts a word: "sep" matches "SEP VClaim" but not "resep". */
const startsWord = (text: string, needle: string) => new RegExp(`(^|[^a-z0-9_])${escapeRegExp(needle)}`).test(text);

/** Table names are written with `_` in the schema, but staff type "kamar inap". */
const tablePhrase = (name: string) => norm(name).replaceAll("_", " ");

/** Table names the query mentions, e.g. "kamar_inap" in "form apa yang mengisi kamar_inap". */
export const tablesInQuery = (query: string, forms: ReadonlyArray<AppForm>): ReadonlyArray<string> => {
  const text = ` ${tablePhrase(query)} `;
  const names = new Set(forms.flatMap((form) => [...form.tables.write, ...form.tables.read]));
  const matched = [...names].filter((name) => name.length >= 3 && text.includes(` ${tablePhrase(name)} `));
  // "kamar_inap" also contains the word "kamar"; the more specific table is the one meant.
  return matched
    .filter((name) => !matched.some((other) => other.length > name.length && tablePhrase(other).startsWith(`${tablePhrase(name)} `)))
    .toSorted();
};

/** Words that make a question about the data a form touches, not about navigation. */
const DATA_WORDS = ["tabel", "table", "mengisi", "menyimpan", "ditulis", "kolom", "field", "sql"];

/**
 * True when the user is asking about a table. A bare word like "kamar" also
 * names a menu, so it only counts with a table word or an underscore (`kamar_inap`).
 */
export const asksAboutTables = (query: string): boolean => {
  const raw = norm(query).split(" ").filter(Boolean);
  return raw.some((word) => DATA_WORDS.includes(word)) || raw.some((word) => word.includes("_"));
};

/** Exact phrase beats all words, all words beat some words. */
const score = (haystack: string, phrase: string, words: ReadonlyArray<string>): number => {
  const text = ` ${norm(haystack)} `;
  let total = 0;
  if (phrase.length >= 3 && startsWord(text, phrase)) total += 8;
  for (const word of words) if (startsWord(text, word)) total += 2;
  if (words.length > 1 && words.every((word) => startsWord(text, word))) total += 3;
  return total;
};

/** Top `limit`, dropping the long tail of one-word coincidences (e.g. every "Kamar" menu for "pindah kamar"). */
const best = <A>(items: ReadonlyArray<A>, scoreOf: (item: A) => number, limit: number, floorRatio = 0.5): A[] => {
  const scored = items
    .map((item) => ({ item, score: scoreOf(item) }))
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  const floor = Math.max(3, top * floorRatio);
  return scored
    .filter((entry) => entry.score >= floor)
    .slice(0, limit)
    .map((entry) => entry.item);
};

/** Synonyms whose term appears word-for-word in the query (so "SEP" never matches "resep"). */
const matchingSynonyms = (query: string, synonyms: ReadonlyArray<AppSynonym>): AppSynonym[] => {
  const words = norm(query).split(" ").filter(Boolean);
  return synonyms.filter((synonym) =>
    synonym.terms.some((term) => {
      const termWords = norm(term).split(" ").filter(Boolean);
      if (termWords.length === 0 || (termWords[0] ?? "").length < 3) return false;
      if (termWords.every((word) => words.includes(word))) return true;
      return termWords.length === 1 && (termWords[0] ?? "").length >= 4 && words.some((word) => word.startsWith(termWords[0] ?? ""));
    }),
  );
};

export const searchApp = (
  docs: AppDocsService,
  query: string,
  scope: AppScope = "semua",
  synonyms: ReadonlyArray<AppSynonym> = [],
): AppSearchResult => {
  const phrase = norm(query);
  const words = tokens(query);
  const rawWords = phrase.split(" ").filter(Boolean);
  if (phrase === "") return { menus: [], flows: [], forms: [], rights: [], synonyms: [], shortcuts: [] };

  const syn = matchingSynonyms(query, synonyms);
  const synMenus = new Set(syn.flatMap((s) => s.menus));
  const synForms = new Set(syn.flatMap((s) => s.forms));
  const mentionedTables = scope === "tabel" || asksAboutTables(query) ? tablesInQuery(query, docs.forms) : [];
  // Writing a table is a much stronger signal than merely reading it: "kamar_inap"
  // is written by DlgKamarInap and only read by a hundred other forms.
  const tableScore = (form: AppForm): number =>
    mentionedTables.reduce((total, table) => total + (form.tables.write.includes(table) ? 20 : form.tables.read.includes(table) ? 7 : 0), 0);

  const menus =
    scope === "semua" || scope === "menu"
      ? best(
          docs.menus,
          (menu) =>
            score(`${menu.label} ${menu.groupName} ${menu.groupTitle} ${menu.rights.join(" ")} ${menu.form ?? ""} ${menu.button}`, phrase, words) +
            (norm(menu.label) === phrase ? 6 : 0) +
            (synMenus.has(menu.path) ? 25 : 0),
          4,
          0.7,
        )
      : [];

  const forms =
    scope === "semua" || scope === "form" || scope === "tabel"
      ? best(
          scope === "tabel" ? docs.forms.filter((form) => tableScore(form) > 0) : docs.forms,
          (form) =>
            score(
              `${form.name} ${form.title} ${form.package} ${form.menus.join(" ")} ${form.rights.join(" ")} ${form.actions.join(" ")} ${form.popup.map((p) => p.path).join(" ")} ${form.tables.read.join(" ")} ${form.tables.write.join(" ")}`,
              phrase,
              words,
            ) +
            tableScore(form) +
            form.actions.filter((action) => {
              const a = norm(action);
              return a.length >= 3 && (phrase.includes(a) || a.includes(phrase));
            }).length * 4 +
            (norm(form.name) === phrase ? 6 : 0) +
            (synForms.has(form.name) ? 25 : 0),
          4,
          0.7,
        )
      : [];

  // A flow is seven steps; only show it when the user asked for the flow, not for
  // "which menu/button" (that answer is much shorter).
  const asksForFlow =
    scope === "alur" ||
    rawWords.some((word) => ["alur", "langkah", "tahap", "flow", "proses", "cara", "mulai", "selesai"].includes(word));
  const flows =
    asksForFlow && scope !== "tabel"
      ? best(
          docs.flows,
          (flow) => {
            // A keyword that the query mentions ("rawat inap" in "alur rawat inap") is the
            // strongest signal: the doc text itself mentions many topics.
            const keywordHits = flow.keywords.filter((keyword) => {
              const k = norm(keyword);
              return k.length >= 3 && (phrase.includes(k) || k.includes(phrase));
            }).length;
            return score(`${flow.title} ${flow.keywords.join(" ")} ${flow.menus.join(" ")} ${flow.forms.join(" ")} ${flow.text}`, phrase, words) + keywordHits * 8;
          },
          2,
          0.7,
        )
      : [];

  // Rights are noisy for normal questions ("kamar" matches a dozen permission names):
  // return them only when the user asks about access, or when the scope says so.
  const asksAboutRights =
    scope === "hak" ||
    rawWords.some((word) =>
      ["hak", "akses", "role", "muncul", "hilang", "kenapa", "mengapa", "gagal", "error", "masalah"].includes(word),
    );
  const rights: AppRight[] =
    asksAboutRights
      ? best(
          docs.rights,
          (right) =>
            score(`${right.name} ${right.menus.join(" ")}`, phrase, words) +
            (norm(right.name) === phrase ? 6 : 0) +
            (words.includes(norm(right.name)) ? 8 : 0) +
            (words.some((word) => norm(right.name).startsWith(word)) ? 4 : 0),
          5,
          0.3,
        )
      : [];
  // "Why is the cashier menu missing?" names the menu, not the right column:
  // include the rights that gate the menus found ("billing_ralan" as well as "kasir_ralan").
  if (asksAboutRights) {
    const seen = new Set(rights.map((right) => right.name));
    for (const menu of menus.slice(0, 2)) {
      for (const name of menu.rights) {
        if (seen.has(name)) continue;
        const right = docs.rights.find((candidate) => candidate.name === name);
        if (right !== undefined) {
          rights.push(right);
          seen.add(name);
        }
      }
    }
  }

  const shortcutHits: ShortcutHit[] = [];
  for (const toolbar of docs.toolbar) {
    const form = docs.forms.find((candidate) => candidate.name === toolbar.form) ?? null;
    shortcutHits.push({ kind: "toolbar", label: toolbar.label, path: `Toolbar → ${toolbar.label}`, form });
  }
  for (const form of docs.forms) {
    for (const item of form.popup) {
      const label = item.path.split(" → ").at(-1) ?? item.path;
      shortcutHits.push({ kind: "klik-kanan", label, path: item.path, form });
    }
  }
  // Rare words decide: "billing" beats "cek" when both hit the label.
  const shortcutTexts = shortcutHits.map((hit) => ({
    hit,
    text: norm(`${hit.label} ${hit.path} ${hit.form?.title ?? ""} ${hit.form?.name ?? ""}`),
  }));
  const frequency = new Map(words.map((word) => [word, shortcutTexts.filter((item) => startsWord(item.text, word)).length]));
  const VERBS = new Set(["input", "isi", "cek", "lihat", "buka", "buat", "tambah", "edit", "hapus", "simpan", "cetak", "cari", "pilih", "ganti", "membuat", "mengisi"]);
  const weight = (word: string) =>
    (VERBS.has(word) ? 0.35 : 1) * (1 + Math.log(Math.max(1, shortcutTexts.length) / (1 + (frequency.get(word) ?? 0))));
  const maxWeight = Math.max(0, ...words.filter((word) => (frequency.get(word) ?? 0) > 0).map((word) => weight(word)));
  // "pindah" is a button in the dialog, not a right-click action: when the user names a button that
  // the opening form has, prefer the menu + button over a shortcut that only opens the dialog.
  const openingForm =
    docs.forms.find((form) => form.name === menus[0]?.form) ??
    docs.forms.find((form) => form.name === docs.menus.find((menu) => menu.path === menus[0]?.path)?.form);
  const buttonWord = openingForm?.actions.find((action) => words.some((word) => word.length >= 4 && startsWord(norm(action), word)));
  const shortcutNamesButton = buttonWord !== undefined && shortcutTexts.some((item) => startsWord(norm(item.hit.label), norm(buttonWord)));
  // A table/rights question is answered by the form or the `user` column; right-click
  // actions that happen to share a word ("Kasir" → "Surat Hamil") only confuse it.
  const asksAboutData = scope === "tabel" || mentionedTables.length > 0 || rawWords.some((word) => DATA_WORDS.includes(word));
  const scoredShortcuts = asksAboutRights || asksAboutData
    ? []
    : buttonWord !== undefined && !shortcutNamesButton
      ? []
      : shortcutTexts
    .filter(({ hit }) => {
      // The item's own label or its immediate submenu must name the rarest word of the query.
      // "Billing/Pembayaran Pasien" does; "Kamar Inap" does not for "pindah kamar".
      const boosted = syn.some((synonym) => synonym.shortcut === hit.path);
      if (boosted) return true;
      const own = norm(hit.label);
      return words.some((word) => weight(word) >= maxWeight * 0.7 && startsWord(own, word));
    })
    .map(({ hit, text }) => {
      let total = 0;
      for (const word of words) if (startsWord(text, word)) total += 2 * weight(word);
      if (norm(hit.label) === phrase) total += 6;
      if (text.includes(phrase)) total += 4;
      if (hit.kind === "klik-kanan") total += 1;
      if (syn.some((synonym) => synonym.shortcut === hit.path)) total += 20;
      return { hit, score: total };
    })
    .filter((entry) => entry.score >= 5)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => entry.hit);

  return { menus, flows, forms, rights, synonyms: syn, shortcuts: scoredShortcuts };
};

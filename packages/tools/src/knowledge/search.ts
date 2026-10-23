/**
 * Finds the knowledge items that match a question, without an embedding model:
 * words are lower-cased, common Indonesian words dropped, a light stemmer
 * removes the most common affixes, and rare words count more than frequent
 * ones (IDF). The score is a cosine-like overlap in [0, 1].
 *
 * A few hundred items are scored in well under a millisecond, so everything
 * is scored in memory on each question.
 */

/** Words that say nothing about the topic of a question. */
const STOPWORDS = new Set(
  (
    "yang di ke dari dan atau untuk pada dengan ini itu ada apa siapa berapa bagaimana kapan mana adalah " +
    "saya kami kita aku tolong mohon coba minta tampilkan tunjukkan lihat cari berikan buat buatkan sebutkan " +
    "data jumlah semua per sekarang tadi juga saja sudah belum bisa akan dalam oleh sebagai para yg dgn utk " +
    "saja kah pun lah nya adalah ialah merupakan ada tidak bukan ya iya ok oke " +
    "the of a an and or to in for on is are what how many show me please"
  ).split(" "),
);

/** Suffixes that usually carry little meaning in a search token. */
const SUFFIXES = ["kannya", "annya", "nya", "an", "kan", "lah", "kah", "pun"];

/** Verb prefixes, stripped only when a useful stem remains. */
const PREFIXES = ["meng", "meny", "mem", "men", "ber", "ter"];

/** A light Indonesian stemmer; conservative enough for medical/Khanza words. */
const stem = (word: string): string => {
  let stemmed = word;
  for (const suffix of SUFFIXES) {
    if (stemmed.endsWith(suffix) && stemmed.length - suffix.length >= 4) {
      stemmed = stemmed.slice(0, -suffix.length);
      break;
    }
  }
  for (const prefix of PREFIXES) {
    if (stemmed.startsWith(prefix) && stemmed.length - prefix.length >= 4) {
      stemmed = stemmed.slice(prefix.length);
      break;
    }
  }
  return stemmed;
};

/** Topic words of a text: lower case, no stopwords, no plain numbers, light stem. */
export const tokenize = (text: string): ReadonlyArray<string> => {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOPWORDS.has(w))
    .map(stem)
    .filter((w) => w.length >= 2);
  return [...new Set(words)];
};

/** Same word, or one a longer form of the other ("obat" / "obatan", "pasien" / "pasiennya"). */
const sameWord = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** Where an item came from; a person's feedback counts more than an automatic save. */
type SearchSource = "auto" | "ai" | "staff" | "feedback";

export interface Searchable {
  readonly id: string;
  /** Text to match against: the question or note, plus a title if there is one. */
  readonly text: string;
  /** Checked by a person; ranked a little higher. */
  readonly verified: boolean;
  readonly source?: SearchSource | undefined;
}

export interface Match<A> {
  readonly item: A;
  readonly score: number;
}

/** Below this, an item shares too little with the question to help. */
const MIN_SCORE = 0.3;

/** Automatic examples should not drown out an item a person checked. */
const sourceWeight = (source: SearchSource | undefined): number => {
  switch (source) {
    case "auto":
      return 0.9;
    case "ai":
      return 0.95;
    case "feedback":
      return 1.1;
    case "staff":
      return 1.1;
    default:
      return 1;
  }
};

/**
 * The best `limit` items for `query`, best first, with a score of at least
 * `minScore`. Verified items get a 25% bonus; automatic examples get a little
 * less than notes from people.
 */
export const rank = <A extends Searchable>(
  query: string,
  items: ReadonlyArray<A>,
  limit: number,
  minScore: number = MIN_SCORE,
): ReadonlyArray<Match<A>> => {
  const queryWords = tokenize(query);
  if (queryWords.length === 0 || items.length === 0) return [];
  const itemWords = items.map((item) => tokenize(item.text));

  // IDF: a word in many items (e.g. "pasien") counts less than a rare one (e.g. "gigi").
  const idf = (word: string) => {
    const containing = itemWords.filter((words) => words.some((w) => sameWord(w, word))).length;
    return Math.log(1 + items.length / (1 + containing)) + 0.1;
  };
  const weight = new Map<string, number>();
  const weightOf = (word: string) => {
    let w = weight.get(word);
    if (w === undefined) {
      w = idf(word);
      weight.set(word, w);
    }
    return w;
  };
  const norm = (words: ReadonlyArray<string>) => Math.sqrt(words.reduce((sum, w) => sum + weightOf(w) ** 2, 0));
  const queryNorm = norm(queryWords);

  const matches: Array<Match<A>> = [];
  items.forEach((item, i) => {
    const words = itemWords[i] ?? [];
    if (words.length === 0) return;
    const shared = queryWords.filter((q) => words.some((w) => sameWord(w, q)));
    if (shared.length === 0) return;
    const overlap = shared.reduce((sum, w) => sum + weightOf(w) ** 2, 0);
    const base = Math.min(1, overlap / (queryNorm * norm(words)));
    const score = Math.min(1, base * (item.verified ? 1.25 : 1) * sourceWeight(item.source));
    if (score >= minScore) matches.push({ item, score });
  });
  return matches.toSorted((a, b) => b.score - a.score).slice(0, limit);
};

/**
 * Text that should not be kept as knowledge, because it is about one patient
 * or visit: a no_rawat (2026/10/21/000002), or a long number (RM, NIK, SEP,
 * phone). Knowledge is about the hospital, not about patients.
 */
export const personalReason = (text: string): string | null => {
  if (/\d{4}\/\d{2}\/\d{2}\/\d+/.test(text)) return "berisi nomor rawat";
  if (/\d{6,}/.test(text)) return "berisi nomor panjang (RM, NIK, SEP atau telepon)";
  // Indonesian mobile numbers with separators, which the 6-digit check misses.
  if (/(?<!\d)(?:\+?62|0)8\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,5}(?!\d)/.test(text)) return "berisi nomor telepon";
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) return "berisi email";
  return null;
};

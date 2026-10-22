import { create } from "zustand";

/**
 * Version counters bumped after a change, so views that show the same data
 * elsewhere (stat row, sidebar lists) fetch it again.
 */
interface Versions {
  /** Tickets, runs and fixes (stat row, Tiket badge). */
  readonly stats: number;
  /** "Percakapan" list in the sidebar. */
  readonly conversations: number;
  /** "Favorit" list in the sidebar. */
  readonly favorites: number;
}

export const useVersions = create<Versions>(() => ({ stats: 0, conversations: 0, favorites: 0 }));

const bump = (key: keyof Versions) => useVersions.setState((v) => ({ [key]: v[key] + 1 }));
export const bumpStats = () => bump("stats");
export const bumpConversations = () => bump("conversations");
export const bumpFavorites = () => bump("favorites");

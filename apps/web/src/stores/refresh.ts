import { create } from "zustand";

/**
 * Version counters bumped after a change, so views that show the same data
 * elsewhere (stat row, sidebar lists) fetch it again.
 */
interface Versions {
  /** "Percakapan" list in the sidebar. */
  readonly conversations: number;
  /** "Favorit" list in the sidebar. */
  readonly favorites: number;
}

export const useVersions = create<Versions>(() => ({ conversations: 0, favorites: 0 }));

const bump = (key: keyof Versions) => useVersions.setState((v) => ({ [key]: v[key] + 1 }));
export const bumpConversations = () => bump("conversations");
export const bumpFavorites = () => bump("favorites");

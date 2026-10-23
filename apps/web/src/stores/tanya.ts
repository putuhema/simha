/**
 * Tanya Data chat: the current thread's answers (stored and streaming).
 * Kept in a store so an answer keeps streaming while the user looks at
 * another tab.
 */
import type { Favorite, RenderBlock, Transcript } from "@simha/shared";
import { create } from "zustand";
import { api, errorMessage } from "../lib/api.ts";
import { emptyRun, fromTranscript, streamRun, type RunView } from "../lib/run.ts";
import { bumpConversations } from "./refresh.ts";

interface TanyaStore {
  readonly conversationId: string | null;
  readonly turns: ReadonlyArray<RunView>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly running: boolean;
  readonly ask: (question: string) => Promise<string | null>;
  readonly stop: () => void;
  readonly open: (conversationId: string) => Promise<void>;
  readonly reset: () => void;
  /** Runs a saved favorite's query again (no AI) and shows the result as a turn. */
  readonly runFavorite: (favorite: Favorite) => Promise<void>;
}

let controller: AbortController | null = null;

export const useTanya = create<TanyaStore>((set, get) => ({
  conversationId: null,
  turns: [],
  loading: false,
  error: null,
  running: false,

  ask: async (question) => {
    if (get().running) return get().conversationId;
    controller = new AbortController();
    const initial = emptyRun(question);
    set({ running: true, error: null, turns: [...get().turns, initial] });
    const replace = (run: RunView) => {
      // A new thread shows up in the sidebar as soon as the server names it.
      const isNew = run.conversationId !== null && get().conversationId === null;
      set({
        turns: get().turns.map((t) => (t.key === run.key ? run : t)),
        ...(run.conversationId ? { conversationId: run.conversationId } : {}),
      });
      if (isNew) bumpConversations();
    };
    const conversationId = get().conversationId;
    const final = await streamRun("/api/ask", conversationId ? { question, conversationId } : { question }, initial, replace, controller.signal);
    set({ running: false });
    bumpConversations();
    return final.conversationId ?? get().conversationId;
  },

  stop: () => controller?.abort(),

  open: async (conversationId) => {
    if (get().conversationId === conversationId && get().turns.length > 0) return;
    controller?.abort();
    set({ conversationId, turns: [], loading: true, error: null, running: false });
    try {
      const transcript = await api.get<Transcript>(`/api/conversations/${conversationId}`);
      set({ turns: transcript.runs.map(fromTranscript), loading: false });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  reset: () => {
    controller?.abort();
    set({ conversationId: null, turns: [], error: null, running: false, loading: false });
  },

  runFavorite: async (favorite) => {
    const run = emptyRun(`★ ${favorite.question}`);
    set({ turns: [...get().turns, run], error: null });
    const replace = (next: RunView) => set({ turns: get().turns.map((t) => (t.key === run.key ? next : t)) });
    try {
      const { block } = await api.post<{ block: RenderBlock }>(`/api/favorites/${favorite.id}/run`);
      replace({ ...run, status: "done", blocks: [block] });
    } catch (error) {
      replace({ ...run, status: "error", error: errorMessage(error) });
    }
  },
}));

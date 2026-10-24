/**
 * Tanya Data chat: the current thread's answers (stored and streaming).
 * Kept in a store so an answer keeps streaming while the user looks at
 * another tab.
 */
import type { AgentMode, Favorite, RenderBlock, Transcript } from "@simha/shared";
import { create } from "zustand";
import { api, errorMessage } from "../lib/api.ts";
import { emptyRun, fromTranscript, streamRun, type RunChange, type RunView } from "../lib/run.ts";
import { bumpConversations } from "./refresh.ts";

/**
 * The part of a running answer that changes with every token, kept out of
 * `turns` so the thread list does not re-render (and re-parse every answer)
 * for each delta. Only a small leaf component subscribes to it.
 */
export interface LiveAnswer {
  readonly key: string;
  readonly text: string;
  readonly reasoning: string;
  readonly writing: boolean;
}

interface TanyaStore {
  readonly conversationId: string | null;
  readonly turns: ReadonlyArray<RunView>;
  /** Token-level state of the run that is streaming now, if any. */
  readonly live: LiveAnswer | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly running: boolean;
  /** How the next question is answered; Tanya Data or a nurse complaint. */
  readonly mode: AgentMode;
  readonly setMode: (mode: AgentMode) => void;
  readonly ask: (question: string) => Promise<string | null>;
  readonly stop: () => void;
  readonly open: (conversationId: string) => Promise<void>;
  readonly reset: () => void;
  /** Runs a saved favorite's query again (no AI) and shows the result as a turn. */
  readonly runFavorite: (favorite: Favorite) => Promise<void>;
}

let controller: AbortController | null = null;

const liveOf = (run: RunView): LiveAnswer => ({
  key: run.key,
  text: run.text,
  reasoning: run.reasoning,
  writing: run.writing,
});

export const useTanya = create<TanyaStore>((set, get) => {
  /**
   * Publishes a run update. Text and reasoning deltas only touch `live`; only a
   * structural change (a step, a card, done) replaces the turn in `turns`.
   */
  const publish = (run: RunView, change: RunChange) => {
    const state = get();
    const current = state.turns.find((t) => t.key === run.key);
    // The thread was reset or another conversation was opened while this run
    // was in flight; its late events must not come back.
    if (!current) return;

    if (change === "token") {
      if (run.status === "running") set({ live: liveOf(run) });
      return;
    }

    // A new thread shows up in the sidebar as soon as the server names it.
    const isNew = run.conversationId !== null && state.conversationId === null;
    const live = run.status === "running" ? liveOf(run) : null;
    set({
      ...(current === run ? {} : { turns: state.turns.map((t) => (t === current ? run : t)) }),
      live,
      ...(run.conversationId ? { conversationId: run.conversationId } : {}),
    });
    if (isNew) bumpConversations();
  };

  return {
    conversationId: null,
    turns: [],
    live: null,
    loading: false,
    error: null,
    running: false,
    mode: "tanya",

    setMode: (mode) => set({ mode }),

    ask: async (question) => {
      if (get().running) return get().conversationId;
      controller = new AbortController();
      const mode = get().mode;
      const initial = emptyRun(question, mode);
      set({ running: true, error: null, turns: [...get().turns, initial], live: null });
      const conversationId = get().conversationId;
      const body = conversationId ? { question, mode, conversationId } : { question, mode };
      const final = await streamRun("/api/ask", body, initial, publish, controller.signal);
      set({ running: false });
      bumpConversations();
      return final.conversationId ?? get().conversationId;
    },

    stop: () => controller?.abort(),

    open: async (conversationId) => {
      if (get().conversationId === conversationId && get().turns.length > 0) return;
      controller?.abort();
      set({ conversationId, turns: [], live: null, loading: true, error: null, running: false, mode: "tanya" });
      try {
        const transcript = await api.get<Transcript>(`/api/conversations/${conversationId}`);
        const turns = transcript.runs.map(fromTranscript);
        set({ turns, loading: false, mode: turns.at(-1)?.mode ?? "tanya" });
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
      }
    },

    reset: () => {
      controller?.abort();
      set({ conversationId: null, turns: [], live: null, error: null, running: false, loading: false, mode: "tanya" });
    },

    runFavorite: async (favorite) => {
      const run = emptyRun(`★ ${favorite.question}`, "tanya");
      set({ turns: [...get().turns, run], error: null });
      const replace = (next: RunView) => set({ turns: get().turns.map((t) => (t.key === run.key ? next : t)) });
      try {
        const { block } = await api.post<{ block: RenderBlock }>(`/api/favorites/${favorite.id}/run`);
        replace({ ...run, status: "done", blocks: [block] });
      } catch (error) {
        replace({ ...run, status: "error", error: errorMessage(error) });
      }
    },
  };
});

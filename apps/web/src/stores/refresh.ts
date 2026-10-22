import { create } from "zustand";

/** Bumped after anything that changes the stat row (tickets, runs, fixes). */
export const useStatsVersion = create<{ readonly version: number; readonly bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

export const bumpStats = () => useStatsVersion.getState().bump();

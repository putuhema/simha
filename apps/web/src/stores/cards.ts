/**
 * Which answer card is open in the right panel. The panel itself lives in the
 * Tanya page; the chat references and the panel share this selection.
 */
import { create } from "zustand";

interface CardsPanelStore {
  readonly open: boolean;
  readonly selectedId: string | null;
  readonly toggle: () => void;
  readonly setOpen: (open: boolean) => void;
  /** Show a card and make sure the panel is visible. */
  readonly select: (id: string) => void;
}

export const useCardsPanel = create<CardsPanelStore>((set, get) => ({
  open: false,
  selectedId: null,
  toggle: () => set({ open: !get().open }),
  setOpen: (open) => set({ open }),
  select: (selectedId) => set({ selectedId, open: true }),
}));

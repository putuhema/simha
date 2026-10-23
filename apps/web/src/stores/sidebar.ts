/**
 * Sidebar state. On a wide window it is open or collapsed to an icon rail
 * (remembered between visits); on a phone it is a drawer, closed by default.
 */
import { create } from "zustand";

const KEY = "simha.sidebar";

const saved = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "collapsed";
  } catch {
    return true;
  }
};

interface SidebarStore {
  /** Wide window: full sidebar (true) or icon rail (false). */
  readonly open: boolean;
  /** Phone: drawer shown. */
  readonly drawer: boolean;
  /** Set when "Cari" is used from the rail, so the search box opens focused. */
  readonly searching: boolean;
  readonly toggle: () => void;
  readonly setDrawer: (open: boolean) => void;
  readonly startSearch: () => void;
  readonly stopSearch: () => void;
}

export const useSidebar = create<SidebarStore>((set, get) => ({
  open: saved(),
  drawer: false,
  searching: false,
  toggle: () => {
    const open = !get().open;
    try {
      localStorage.setItem(KEY, open ? "open" : "collapsed");
    } catch {
      // Private mode: just do not remember it.
    }
    set({ open });
  },
  setDrawer: (drawer) => set({ drawer }),
  startSearch: () => set({ open: true, searching: true }),
  stopSearch: () => set({ searching: false }),
}));

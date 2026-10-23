/**
 * The desktop app's bridge (window.simrsDesktop), present only when the UI
 * runs inside the SIMRS Harness desktop app. In a normal browser `desktop`
 * is null and desktop-only buttons are not shown.
 */

export interface DesktopInfo {
  readonly version: string;
  readonly platform: string;
  readonly mode: "remote" | "local" | null;
  readonly serverUrl: string;
  readonly port: number;
  readonly khanzaLauncher: string | null;
}

export type KhanzaResult =
  | { readonly status: "focused" | "launched"; readonly copied: string | null }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string };

/** Khanza stopped this many seconds after "Buka di Khanza" started it. */
export interface KhanzaExit {
  readonly seconds: number;
  readonly code: number | null;
}

interface DesktopBridge {
  /** "darwin", "win32"… */
  readonly platform: string;
  readonly info: () => Promise<DesktopInfo>;
  readonly openKhanza: (copy?: string | null) => Promise<KhanzaResult>;
  readonly chooseKhanzaLauncher: () => Promise<string | null>;
  readonly openSetup: () => Promise<void>;
  /** Show or hide the terminal panel (the UI cannot type into it). */
  readonly toggleTerminal: () => Promise<void>;
  /** Open the terminal panel on the "Output Khanza" tab. */
  readonly showKhanzaOutput: () => Promise<void>;
  /** Returns an unsubscribe function. */
  readonly onKhanzaExit: (callback: (exit: KhanzaExit) => void) => () => void;
}

export const desktop: DesktopBridge | null =
  (globalThis as { readonly simrsDesktop?: DesktopBridge }).simrsDesktop ?? null;

const NO_RAWAT = /\b\d{4}\/\d{2}\/\d{2}\/\d{6}\b/;
const NO_RM = /\bRM[:.\s]*(\d{4,10})\b/i;

/** What to paste into Khanza's search: the first no. rawat in the text, else the no. RM. */
export const khanzaTarget = (...texts: ReadonlyArray<string | null | undefined>): string | null => {
  for (const text of texts) {
    const rawat = text ? NO_RAWAT.exec(text)?.[0] : undefined;
    if (rawat) return rawat;
  }
  for (const text of texts) {
    const rm = text ? NO_RM.exec(text)?.[1] : undefined;
    if (rm) return rm;
  }
  return null;
};

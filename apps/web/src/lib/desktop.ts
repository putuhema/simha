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
  | { readonly status: "form_opened"; readonly form: string; readonly copied: string | null }
  | {
      readonly status: "focused" | "launched";
      readonly copied: string | null;
      /** Opens by itself after the user logs in to the Khanza that was just started. */
      readonly pendingForm?: string;
      /** Why the form did not open directly: "missing" = not logged in, or a Khanza build without the bridge. */
      readonly bridge?: "missing" | { readonly error: string };
    }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string };

/** Khanza forms the bridge can open. "resume" and "soap" pick ranap or ralan from the visit. */
export type KhanzaForm = "resume" | "soap" | "riwayat";

export const KHANZA_FORMS: ReadonlyArray<{ readonly form: KhanzaForm; readonly label: string; readonly needsVisit: boolean }> = [
  { form: "resume", label: "Resume medis", needsVisit: true },
  { form: "soap", label: "CPPT / SOAP", needsVisit: true },
  { form: "riwayat", label: "Riwayat perawatan", needsVisit: false },
];

/** Khanza stopped this many seconds after "Buka di Khanza" started it. */
export interface KhanzaExit {
  readonly seconds: number;
  readonly code: number | null;
}

interface DesktopBridge {
  /** "darwin", "win32"… */
  readonly platform: string;
  readonly info: () => Promise<DesktopInfo>;
  readonly openKhanza: (copy?: string | null, target?: { readonly form: KhanzaForm; readonly value: string } | null) => Promise<KhanzaResult>;
  /** `user`: who is logged in to a Khanza with the bridge, or null. */
  readonly khanzaBridge: () => Promise<{ readonly user: string | null }>;
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

/** The first no. rawat in the texts. */
export const noRawatIn = (...texts: ReadonlyArray<string | null | undefined>): string | null => {
  for (const text of texts) {
    const found = text ? NO_RAWAT.exec(text)?.[0] : undefined;
    if (found) return found;
  }
  return null;
};

/** The first "RM 000123" in the texts. */
export const noRmIn = (...texts: ReadonlyArray<string | null | undefined>): string | null => {
  for (const text of texts) {
    const found = text ? NO_RM.exec(text)?.[1] : undefined;
    if (found) return found;
  }
  return null;
};

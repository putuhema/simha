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

/** Result of "Isi di Khanza". */
export type KhanzaFillResult =
  /** Khanza's form is open and filled: "baru" = click Simpan, "ganti" = a resume exists, click Ganti. */
  | { readonly status: "filled"; readonly mode: "baru" | "ganti" }
  /** Khanza was started; the form fills itself after the user logs in. */
  | { readonly status: "waiting_login" }
  /** Khanza is open but not logged in, or its build has no bridge. */
  | { readonly status: "bridge_missing" }
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
  /** Opens Khanza's form for the visit filled with these values (never saves); starts Khanza first if needed. */
  readonly fillKhanza: (request: { readonly form: "resume_ranap"; readonly noRawat: string; readonly fields: Readonly<Record<string, string>> }) => Promise<KhanzaFillResult>;
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

/** The Khanza form an answer is about (first one named), or null: only then "Buka di Khanza" makes sense. */
export const formMentioned = (text: string): KhanzaForm | null => {
  const found = [
    { form: "resume" as const, at: text.search(/\bresume\b/i) },
    { form: "soap" as const, at: text.search(/\b(cppt|soap)\b/i) },
    { form: "riwayat" as const, at: text.search(/\briwayat (perawatan|pasien)\b/i) },
  ]
    .filter((f) => f.at >= 0)
    .toSorted((a, b) => a.at - b.at);
  return found[0]?.form ?? null;
};

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

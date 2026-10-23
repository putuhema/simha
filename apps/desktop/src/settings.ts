/**
 * Desktop settings, stored as JSON in the user's app data folder
 * (%APPDATA%\Simha\settings.json on Windows).
 */
import { app } from "electron";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DesktopSettings {
  /**
   * "remote": open a harness server on the hospital network.
   * "local": start the server on this computer (config in .env next to settings.json).
   * null: not set up yet, show the setup page.
   */
  readonly mode: "remote" | "local" | null;
  /** Remote mode: e.g. http://10.0.0.5:8787 */
  readonly serverUrl: string;
  /** Local mode: port of the server on 127.0.0.1. */
  readonly port: number;
  /** The file that starts Khanza on this PC (.bat, .cmd, .exe or .jar). */
  readonly khanzaLauncher: string | null;
}

const DEFAULTS: DesktopSettings = { mode: null, serverUrl: "", port: 8787, khanzaLauncher: null };

export const dataDir = () => app.getPath("userData");
const file = () => path.join(dataDir(), "settings.json");

/**
 * Simha used to be called "SIMRS Harness": move the old data folder into
 * `next` once, so settings, .env, the audit DB and logs survive the rename.
 * Does nothing when `next` already exists, and never throws.
 */
export const migrateDataDir = (next: string, previous: string): void => {
  try {
    if (!existsSync(next) && existsSync(previous)) renameSync(previous, next);
  } catch {
    // A failed move only means the app starts empty; never block start-up.
  }
};

export const loadSettings = (): DesktopSettings => {
  try {
    if (!existsSync(file())) return DEFAULTS;
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<DesktopSettings>;
    return {
      mode: raw.mode === "remote" || raw.mode === "local" ? raw.mode : null,
      serverUrl: typeof raw.serverUrl === "string" ? raw.serverUrl : "",
      port: typeof raw.port === "number" && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULTS.port,
      khanzaLauncher: typeof raw.khanzaLauncher === "string" && raw.khanzaLauncher !== "" ? raw.khanzaLauncher : null,
    };
  } catch {
    return DEFAULTS;
  }
};

export const saveSettings = async (next: DesktopSettings): Promise<void> => {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(file(), JSON.stringify(next, null, 2), "utf8");
};

/** "http://10.0.0.5:8787/" -> "http://10.0.0.5:8787"; null when it is not an http(s) URL. */
export const normalizeServerUrl = (input: string): string | null => {
  try {
    const url = new URL(input.trim().includes("://") ? input.trim() : `http://${input.trim()}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
};

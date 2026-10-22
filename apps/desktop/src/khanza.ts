/**
 * "Buka di Khanza": brings the SIMRS Khanza window to the front, or starts it
 * with the hospital's own launcher (usually a .bat). The no. rawat or no. RM
 * is copied to the clipboard so the user can paste it into Khanza's search.
 *
 * Khanza has no way to open a given form from outside (yet), so this only
 * opens the app; see docs/PLAN.md for the planned Khanza patch.
 */
import { clipboard, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

export type KhanzaResult =
  | { readonly status: "focused" | "launched"; readonly copied: string | null }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string };

const LAUNCHER_TYPES = [".bat", ".cmd", ".exe", ".jar", ".sh", ".command", ".app"];

export const isLauncher = (file: string) => LAUNCHER_TYPES.includes(path.extname(file).toLowerCase());

/**
 * Windows: finds a running Khanza window (a java/javaw process whose title is
 * Khanza's: "::[ Khanza SIMKES ]::" or "SIM <nama instansi>") and brings it to
 * the front. Resolves false when there is none.
 */
const focusRunningKhanza = () =>
  new Promise<boolean>((resolve) => {
    if (process.platform !== "win32") return resolve(false);
    const script = [
      "$p = Get-Process java,javaw -ErrorAction SilentlyContinue |",
      "  Where-Object { $_.MainWindowTitle -match 'Khanza|^SIM ' } | Select-Object -First 1;",
      "if ($p) { $null = (New-Object -ComObject WScript.Shell).AppActivate($p.Id); 'found' } else { 'none' }",
    ].join(" ");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => resolve(!error && stdout.trim() === "found"),
    );
  });

/** Starts the launcher detached from this app, in its own folder (Khanza .bat files use relative paths). */
const launch = (launcher: string): Promise<void> => {
  const cwd = path.dirname(launcher);
  const ext = path.extname(launcher).toLowerCase();
  const detached = { cwd, detached: true, stdio: "ignore" as const, windowsHide: true };
  if (process.platform === "win32") {
    if (ext === ".bat" || ext === ".cmd") {
      spawn("cmd.exe", ["/d", "/c", `"${launcher}"`], { ...detached, windowsVerbatimArguments: true }).unref();
    } else if (ext === ".jar") {
      spawn("javaw", ["-jar", launcher], detached).unref();
    } else {
      spawn(launcher, [], detached).unref();
    }
    return Promise.resolve();
  }
  // macOS / Linux (for development): let the OS open it.
  if (ext === ".jar") {
    spawn("java", ["-jar", launcher], detached).unref();
    return Promise.resolve();
  }
  return shell.openPath(launcher).then((error) => {
    if (error) throw new Error(error);
  });
};

export const openKhanza = async (launcher: string | null, copy: string | null): Promise<KhanzaResult> => {
  if (copy) clipboard.writeText(copy);
  if (await focusRunningKhanza()) return { status: "focused", copied: copy };
  if (!launcher) return { status: "not_configured" };
  try {
    await stat(launcher);
  } catch {
    return { status: "error", message: `File Khanza tidak ditemukan: ${launcher}` };
  }
  try {
    await launch(launcher);
    return { status: "launched", copied: copy };
  } catch (error) {
    return { status: "error", message: `Khanza tidak bisa dibuka: ${error instanceof Error ? error.message : String(error)}` };
  }
};

/**
 * "Buka di Khanza": brings the SIMRS Khanza window to the front, or starts it
 * with the hospital's own launcher (usually a .bat). The no. rawat or no. RM
 * is copied to the clipboard so the user can paste it into Khanza's search.
 *
 * Works on Windows (.bat, as on the hospital PCs) and macOS (the .jar or a
 * .sh). Khanza has no way to open a given form from outside (yet), so this
 * only opens the app; see docs/PLAN.md for the planned Khanza patch.
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

/** The main Khanza app jar (the services and queue screens are other jars). */
const MAIN_JAR = "SIMRSKhanza.jar";
/** Same memory settings as Khanza's own Aplikasi.bat. */
const JAVA_FLAGS = ["-Xss2m", "-Xms512m", "-Xmx2048m", "-XX:+UseG1GC", "-XX:MaxGCPauseMillis=200"];

const run = (file: string, args: ReadonlyArray<string>) =>
  new Promise<string | null>((resolve) =>
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout.trim())),
  );

/**
 * Windows: a java/javaw process whose window title is Khanza's
 * ("::[ Khanza SIMKES ]::" or "SIM <nama instansi>") is brought to the front.
 */
const focusOnWindows = async () => {
  const script = [
    "$p = Get-Process java,javaw -ErrorAction SilentlyContinue |",
    "  Where-Object { $_.MainWindowTitle -match 'Khanza|^SIM ' } | Select-Object -First 1;",
    "if ($p) { $null = (New-Object -ComObject WScript.Shell).AppActivate($p.Id); 'found' } else { 'none' }",
  ].join(" ");
  return (await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])) === "found";
};

/**
 * macOS: a java process running the main Khanza jar is brought to the front
 * (macOS asks once to allow "System Events"). Counts as found even if that is
 * refused, so Khanza is never started twice.
 */
const focusOnMac = async (jar: string) => {
  const pid = (await run("/usr/bin/pgrep", ["-f", jar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]))?.split(/\s+/)[0];
  if (!pid) return false;
  await run("/usr/bin/osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`]);
  return true;
};

/** Finds a running Khanza and brings it to the front; false when Khanza is not running. */
const focusRunningKhanza = (launcher: string | null) => {
  if (process.platform === "win32") return focusOnWindows();
  if (process.platform === "darwin") {
    const jar = launcher && path.extname(launcher).toLowerCase() === ".jar" ? path.basename(launcher) : MAIN_JAR;
    return focusOnMac(jar);
  }
  return Promise.resolve(false);
};

/** Starts the launcher detached from this app, in its own folder (Khanza reads its settings from there). */
const launch = async (launcher: string): Promise<void> => {
  const cwd = path.dirname(launcher);
  const ext = path.extname(launcher).toLowerCase();
  const detached = { cwd, detached: true, stdio: "ignore" as const, windowsHide: true };
  const start = (file: string, args: ReadonlyArray<string>, extra: object = {}) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, { ...detached, ...extra });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  if (ext === ".jar") return start(process.platform === "win32" ? "javaw" : "java", [...JAVA_FLAGS, "-jar", launcher]);
  if (process.platform === "win32") {
    if (ext === ".bat" || ext === ".cmd") return start("cmd.exe", ["/d", "/c", `"${launcher}"`], { windowsVerbatimArguments: true });
    return start(launcher, []);
  }
  if (ext === ".sh" || ext === ".command") return start("/bin/sh", [launcher]);
  const error = await shell.openPath(launcher);
  if (error) throw new Error(error);
};

export const openKhanza = async (launcher: string | null, copy: string | null): Promise<KhanzaResult> => {
  if (copy) clipboard.writeText(copy);
  if (await focusRunningKhanza(launcher)) return { status: "focused", copied: copy };
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

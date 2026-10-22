/**
 * "Buka di Khanza": brings the SIMRS Khanza window to the front, or starts it
 * with the hospital's own launcher (usually a .bat). The no. rawat or no. RM
 * is copied to the clipboard so the user can paste it into Khanza's search.
 *
 * Works on Windows (.bat, as on the hospital PCs) and macOS (the .jar or a
 * .sh). Khanza has no way to open a given form from outside (yet), so this
 * only opens the app; see docs/PLAN.md for the planned Khanza patch.
 *
 * Khanza runs on its own (it keeps running when this app quits). Everything
 * it prints goes to logs/khanza.log; if it stops within EARLY_EXIT_SECONDS,
 * the UI is told so the user can look at that output.
 */
import { clipboard, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

/** Khanza stopping sooner than this after a start means something went wrong. */
const EARLY_EXIT_SECONDS = 15;

export interface KhanzaExit {
  readonly seconds: number;
  readonly code: number | null;
}

export interface LaunchOptions {
  /** logs/khanza.log: Khanza's output from the last start. */
  readonly logFile: string;
  /** Called when Khanza stops within EARLY_EXIT_SECONDS of a start. */
  readonly onEarlyExit: (exit: KhanzaExit) => void;
}

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
const launch = async (launcher: string, options: LaunchOptions): Promise<void> => {
  const cwd = path.dirname(launcher);
  const ext = path.extname(launcher).toLowerCase();
  const start = (file: string, args: ReadonlyArray<string>, extra: object = {}) =>
    new Promise<void>((resolve, reject) => {
      mkdirSync(path.dirname(options.logFile), { recursive: true });
      const log = openSync(options.logFile, "w");
      writeSync(log, `# ${new Date().toLocaleString("id-ID")} · ${launcher}\n# ${[file, ...args].join(" ")}\n\n`);
      const startedAt = Date.now();
      const child = spawn(file, args, { cwd, detached: true, stdio: ["ignore", log, log], windowsHide: true, ...extra });
      closeSync(log); // the child keeps its own handle
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      child.once("exit", (code) => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        if (seconds < EARLY_EXIT_SECONDS) options.onEarlyExit({ seconds, code });
      });
    });
  if (ext === ".jar") return start(process.platform === "win32" ? "javaw" : "java", [...JAVA_FLAGS, "-jar", launcher]);
  if (process.platform === "win32") {
    if (ext === ".bat" || ext === ".cmd") return start("cmd.exe", ["/d", "/c", `"${launcher}"`], { windowsVerbatimArguments: true });
    return start(launcher, []);
  }
  if (ext === ".sh" || ext === ".command") return start("/bin/sh", [launcher]);
  // Khanza's Aplikasi.bat is a single "java -jar ..." line, which a shell can run
  // too (like ./Aplikasi.bat in a terminal). Windows line endings are dropped first.
  if (ext === ".bat" || ext === ".cmd") return start("/bin/sh", ["-c", 'tr -d "\\r" < "$0" | /bin/sh', launcher]);
  const error = await shell.openPath(launcher);
  if (error) throw new Error(error);
};

export const openKhanza = async (launcher: string | null, copy: string | null, options: LaunchOptions): Promise<KhanzaResult> => {
  if (copy) clipboard.writeText(copy);
  if (await focusRunningKhanza(launcher)) return { status: "focused", copied: copy };
  if (!launcher) return { status: "not_configured" };
  try {
    await stat(launcher);
  } catch {
    return { status: "error", message: `File Khanza tidak ditemukan: ${launcher}` };
  }
  try {
    await launch(launcher, options);
    return { status: "launched", copied: copy };
  } catch (error) {
    return { status: "error", message: `Khanza tidak bisa dibuka: ${error instanceof Error ? error.message : String(error)}` };
  }
};

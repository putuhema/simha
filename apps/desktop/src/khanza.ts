/**
 * "Buka di Khanza": brings the SIMRS Khanza window to the front, or starts it
 * with the hospital's own launcher (usually a .bat). The no. rawat or no. RM
 * is copied to the clipboard so the user can paste it into Khanza's search.
 *
 * Works on Windows (.bat, as on the hospital PCs) and macOS (the .jar or a
 * .sh). With a target form and a Khanza build that has the bridge
 * (HarnessBridge.java), the form opens directly for that visit; if Khanza is
 * not running yet it is started and the form opens after the user logs in.
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
import { fillForm, FORM_LABELS, openForm, waitForBridge, type BridgeTarget } from "./khanza-bridge.ts";

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
  /** The bridge opened the form in the running Khanza. */
  | { readonly status: "form_opened"; readonly form: string; readonly copied: string | null }
  /**
   * Khanza brought to the front or started. `pendingForm`: it will open after login.
   * `bridge`: why the form could not be opened directly (missing = not logged in or a Khanza build without the bridge).
   */
  | {
      readonly status: "focused" | "launched";
      readonly copied: string | null;
      readonly pendingForm?: string;
      readonly bridge?: "missing" | { readonly error: string };
    }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string };

/** How long a started Khanza may take to be logged in before a queued form is dropped. */
const LOGIN_WAIT_MS = 5 * 60_000;
/** Only the newest queued form opens after login. */
let pendingRequest = 0;

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
  // Khanza's Linux/macOS Aplikasi.bat is a single `java -jar ...` line. On
  // macOS, a packaged GUI app may inherit a different PATH/JAVA_HOME than the
  // user's login shell. Prefer the installed Java 15 runtime, which avoids a
  // Windows Swing LookAndFeel access error seen on Java 17 with this Khanza
  // build. Fall back to the user's configured `java` when Java 15 is absent.
  // Windows line endings are dropped first. A login shell may resolve Java 15
  // from .zprofile, while an app launched from Finder may not inherit that
  // environment; select the system's Java 15 on macOS for this launcher.
  if (ext === ".bat" || ext === ".cmd") {
    const java15Home = process.platform === "darwin" ? await run("/usr/libexec/java_home", ["-v", "15"]) : null;
    const java15 = java15Home ? path.join(java15Home, "bin") : null;
    if (java15) {
      try {
        await stat(path.join(java15, "java"));
        return start("/bin/sh", ["-c", 'tr -d "\\r" < "$0" | /bin/sh', launcher], {
          env: { ...process.env, PATH: `${java15}:${process.env.PATH ?? ""}`, JAVA_HOME: java15Home! },
        });
      } catch {
        // No usable Java 15 installation: keep the user's normal PATH.
      }
    }
    return start("/bin/sh", ["-c", 'tr -d "\\r" < "$0" | /bin/sh', launcher]);
  }
  const error = await shell.openPath(launcher);
  if (error) throw new Error(error);
};

export const openKhanza = async (
  launcher: string | null,
  copy: string | null,
  options: LaunchOptions,
  target: BridgeTarget | null = null,
): Promise<KhanzaResult> => {
  if (copy) clipboard.writeText(copy);
  let bridge: "missing" | { readonly error: string } | undefined;
  if (target) {
    const opened = await openForm(target);
    if (opened?.ok) {
      await focusRunningKhanza(launcher);
      return { status: "form_opened", form: FORM_LABELS[target.form], copied: copy };
    }
    bridge = opened === null ? "missing" : { error: opened.message };
  }
  if (await focusRunningKhanza(launcher)) return { status: "focused", copied: copy, ...(bridge ? { bridge } : {}) };
  if (!launcher) return { status: "not_configured" };
  try {
    await stat(launcher);
  } catch {
    return { status: "error", message: `File Khanza tidak ditemukan: ${launcher}` };
  }
  try {
    await launch(launcher, options);
  } catch (error) {
    return { status: "error", message: `Khanza tidak bisa dibuka: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!target) return { status: "launched", copied: copy };
  // Open the form as soon as the user has logged in to the Khanza we just started.
  const id = ++pendingRequest;
  void waitForBridge(LOGIN_WAIT_MS, () => id !== pendingRequest).then(async (ready) => {
    if (!ready || id !== pendingRequest) return;
    if ((await openForm(target))?.ok) await focusRunningKhanza(launcher);
  });
  return { status: "launched", copied: copy, pendingForm: FORM_LABELS[target.form] };
};

export type KhanzaFillResult =
  | { readonly status: "filled"; readonly mode: "baru" | "ganti" }
  | { readonly status: "waiting_login" }
  | { readonly status: "bridge_missing" }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string };

/**
 * "Isi di Khanza": opens Khanza's form for the visit, filled with the draft (Khanza does not save; the user
 * checks and clicks Simpan/Ganti there). If Khanza is not running it is started and filled after login.
 */
export const fillKhanza = async (
  launcher: string | null,
  options: LaunchOptions,
  request: { readonly form: string; readonly noRawat: string; readonly fields: Readonly<Record<string, string>> },
): Promise<KhanzaFillResult> => {
  const filled = await fillForm(request.form, request.noRawat, request.fields);
  if (filled?.ok) {
    await focusRunningKhanza(launcher);
    return { status: "filled", mode: filled.mode };
  }
  if (filled) return { status: "error", message: filled.message };
  if (await focusRunningKhanza(launcher)) return { status: "bridge_missing" };
  if (!launcher) return { status: "not_configured" };
  try {
    await stat(launcher);
    await launch(launcher, options);
  } catch (error) {
    return { status: "error", message: `Khanza tidak bisa dibuka: ${error instanceof Error ? error.message : String(error)}` };
  }
  const id = ++pendingRequest;
  void waitForBridge(LOGIN_WAIT_MS, () => id !== pendingRequest).then(async (ready) => {
    if (!ready || id !== pendingRequest) return;
    if ((await fillForm(request.form, request.noRawat, request.fields))?.ok) await focusRunningKhanza(launcher);
  });
  return { status: "waiting_login" };
};

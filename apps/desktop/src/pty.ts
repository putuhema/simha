/**
 * Terminals for the terminal panel: each tab is a real shell on this PC
 * (PowerShell on Windows, the user's login shell on macOS/Linux), or a
 * read-only view that follows Khanza's output log.
 *
 * Only the terminal panel page talks to this (see main.ts); the harness web
 * UI can open the panel but never type into a shell.
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IPty } from "node-pty";

export type TerminalKind = "shell" | "khanza-log";

export interface TerminalEvents {
  readonly data: (id: number, data: string) => void;
  readonly exit: (id: number, code: number) => void;
}

/** Most tabs at once; a stuck page cannot start shells without end. */
const MAX_TERMINALS = 8;

const terminals = new Map<number, IPty>();
let nextId = 1;

// Loaded on first use (plain require: Electron then finds the native files
// unpacked next to app.asar). Only needed when a terminal opens.
let ptyModule: typeof import("node-pty") | null = null;
const loadPty = () => (ptyModule ??= require("node-pty") as typeof import("node-pty"));

const shellEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env["ELECTRON_RUN_AS_NODE"];
  env["TERM"] = "xterm-256color";
  env["COLORTERM"] = "truecolor";
  return env;
};

/** Where a new shell starts: the Khanza folder when one is set (so ./Aplikasi.bat just works), else home. */
export const startFolder = (khanzaLauncher: string | null): string => {
  if (khanzaLauncher) {
    const dir = path.dirname(khanzaLauncher);
    try {
      if (statSync(dir).isDirectory()) return dir;
    } catch {
      // Folder gone: fall back to home.
    }
  }
  return os.homedir();
};

const commandFor = (kind: TerminalKind, logFile: string): { file: string; args: Array<string> } => {
  const windows = process.platform === "win32";
  if (kind === "khanza-log") {
    return windows
      ? { file: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-Command", `Get-Content -LiteralPath '${logFile.replaceAll("'", "''")}' -Tail 200 -Wait`] }
      : { file: "/usr/bin/tail", args: ["-n", "200", "-F", logFile] };
  }
  return windows ? { file: "powershell.exe", args: ["-NoLogo"] } : { file: process.env["SHELL"] || "/bin/zsh", args: ["-l"] };
};

export const createTerminal = async (
  kind: TerminalKind,
  size: { readonly cols: number; readonly rows: number },
  options: { readonly cwd: string; readonly logFile: string },
  events: TerminalEvents,
): Promise<number> => {
  if (terminals.size >= MAX_TERMINALS) throw new Error(`Paling banyak ${MAX_TERMINALS} terminal sekaligus.`);
  if (kind === "khanza-log" && !existsSync(options.logFile)) {
    await mkdir(path.dirname(options.logFile), { recursive: true });
    await writeFile(options.logFile, "Belum ada output. Khanza belum pernah dibuka dari aplikasi ini.\n");
  }
  const pty = loadPty();
  const { file, args } = commandFor(kind, options.logFile);
  const term = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: Math.max(20, Math.min(500, Math.floor(size.cols))),
    rows: Math.max(5, Math.min(200, Math.floor(size.rows))),
    cwd: options.cwd,
    env: shellEnv(),
    useConpty: true,
  });
  const id = nextId++;
  terminals.set(id, term);
  term.onData((data) => events.data(id, data));
  term.onExit(({ exitCode }) => {
    terminals.delete(id);
    events.exit(id, exitCode);
  });
  return id;
};

export const writeTerminal = (id: number, data: string) => terminals.get(id)?.write(data);

export const resizeTerminal = (id: number, cols: number, rows: number) => {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
  try {
    terminals.get(id)?.resize(Math.max(20, Math.min(500, Math.floor(cols))), Math.max(5, Math.min(200, Math.floor(rows))));
  } catch {
    // The shell already exited.
  }
};

export const killTerminal = (id: number) => {
  const term = terminals.get(id);
  terminals.delete(id);
  try {
    term?.kill();
  } catch {
    // Already gone.
  }
};

export const killAllTerminals = () => {
  for (const id of terminals.keys()) killTerminal(id);
};

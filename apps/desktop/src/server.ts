/**
 * Local mode: runs the bundled harness server with Electron's own Node
 * (ELECTRON_RUN_AS_NODE), so the PC needs no Node.js install.
 *
 * Configuration comes from the .env file in the app data folder (created
 * from the template on first run). Relative paths in it are resolved from
 * that folder; the audit database lives there too.
 */
import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./settings.ts";

/** Where the bundled files are: resources/ when installed, the repo while developing. */
const resources = () => {
  if (app.isPackaged) {
    const r = process.resourcesPath;
    return {
      server: path.join(r, "server", "main.mjs"),
      web: path.join(r, "web"),
      docs: path.join(r, "docs"),
      envTemplate: path.join(r, "env.example"),
    };
  }
  const repo = path.resolve(app.getAppPath(), "..", "..");
  return {
    server: path.join(app.getAppPath(), "build", "server", "main.mjs"),
    web: path.join(repo, "apps", "web", "dist"),
    docs: path.join(repo, "docs"),
    envTemplate: path.join(repo, ".env.example"),
  };
};

/** The .env the local server reads. While developing, the repo's own .env is used. */
const envFile = () =>
  app.isPackaged ? path.join(dataDir(), ".env") : path.resolve(app.getAppPath(), "..", "..", ".env");

/** Minimal .env parser: KEY=VALUE lines, # comments, optional quotes. */
export const parseEnv = (text: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    let value = match[2] ?? "";
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    env[match[1]] = value;
  }
  return env;
};

/** Creates the .env from the template the first time, so IT staff have a file to fill in. */
export const ensureEnvFile = async (): Promise<string> => {
  const target = envFile();
  if (!existsSync(target)) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(resources().envTemplate, target);
  }
  return target;
};

const withinDataDir = (value: string | undefined, fallback: string) =>
  path.resolve(dataDir(), value && value !== "" ? value : fallback);

let child: ChildProcess | null = null;
const logFile = () => path.join(dataDir(), "logs", "server.log");

/**
 * The end of the server log for the setup page when startup fails, without
 * stack-trace lines, so the reason ("Access denied for user …") is visible.
 */
export const serverLogTail = (lines = 8): string => {
  try {
    const useful = readFileSync(logFile(), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "" && !/^\s+at\s/.test(line) && !/^\s*[{}]\s*$/.test(line));
    return useful.slice(-lines).join("\n");
  } catch {
    return "";
  }
};

const healthy = async (url: string) => {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
};

/** Starts the server and resolves with its URL once /api/health answers (or rejects with the reason). */
export const startLocalServer = async (port: number): Promise<string> => {
  const url = `http://127.0.0.1:${port}`;
  if (child) return url;
  const r = resources();
  const fileEnv = parseEnv(readFileSync(await ensureEnvFile(), "utf8"));
  const docs = (name: string) => (existsSync(path.join(r.docs, name)) ? path.join(r.docs, name) : withinDataDir(undefined, name));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...fileEnv,
    ELECTRON_RUN_AS_NODE: "1",
    // The desktop app talks to its own server on this PC only.
    SERVER_HOST: fileEnv["SERVER_HOST"] || "127.0.0.1",
    SERVER_PORT: String(port),
    WEB_DIST_DIR: r.web,
    AUDIT_DB_PATH: withinDataDir(fileEnv["AUDIT_DB_PATH"], "data/audit.sqlite"),
    SCHEMA_DOC_PATH: fileEnv["SCHEMA_DOC_PATH"] ? withinDataDir(fileEnv["SCHEMA_DOC_PATH"], "") : docs("schema.md"),
    KHANZA_NOTES_PATH: fileEnv["KHANZA_NOTES_PATH"] ? withinDataDir(fileEnv["KHANZA_NOTES_PATH"], "") : docs("khanza_notes.md"),
  };
  await mkdir(path.dirname(env["AUDIT_DB_PATH"] ?? dataDir()), { recursive: true });
  await mkdir(path.dirname(logFile()), { recursive: true });
  const log = createWriteStream(logFile(), { flags: "w" });

  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", r.server], {
    env,
    cwd: dataDir(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child = proc;
  proc.stdout?.pipe(log);
  proc.stderr?.pipe(log);

  let exited: string | null = null;
  proc.once("exit", (code) => {
    exited = `Server berhenti (kode ${code ?? "?"}).`;
    if (child === proc) child = null;
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(exited);
    if (await healthy(url)) return url;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  stopLocalServer();
  throw new Error("Server tidak menjawab dalam 30 detik.");
};

export const stopLocalServer = () => {
  child?.kill();
  child = null;
};

/** For remote mode: is there a harness server at this URL? */
export const checkServer = async (url: string): Promise<{ readonly ok: boolean; readonly message: string }> => {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, message: `Server menjawab ${res.status}.` };
    const body = (await res.json()) as { khanza?: { connected?: boolean } };
    if (!body || typeof body !== "object" || !("khanza" in body)) return { ok: false, message: "Alamat ini bukan server Simha." };
    return { ok: true, message: body.khanza?.connected ? "Terhubung. Khanza DB terhubung." : "Terhubung, tapi server belum terhubung ke Khanza DB." };
  } catch (error) {
    return { ok: false, message: `Tidak bisa dihubungi: ${error instanceof Error ? error.message : String(error)}` };
  }
};

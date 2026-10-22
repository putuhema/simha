/**
 * pnpm --filter @simrs/desktop dev: builds, then starts the desktop app.
 * Clears ELECTRON_RUN_AS_NODE, which some terminals (inside other Electron
 * apps) set and which would make Electron run as plain Node.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

await import("./build.mjs");
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const child = spawn(electron, [app], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));

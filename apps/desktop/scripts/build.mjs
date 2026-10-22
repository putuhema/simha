/**
 * Builds everything the desktop app needs into apps/desktop/build:
 *
 *   build/main.cjs, build/preload.cjs   Electron main process and preload
 *   build/setup/                        the connection settings page
 *   build/server/main.mjs               the whole harness server in one file
 *   build/server/system-prompt.md       read next to the server bundle
 *
 * The web UI (apps/web/dist) and docs/ are added by electron-builder.
 * Usage: node scripts/build.mjs
 */
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const app = path.resolve(here, "..");
const repo = path.resolve(app, "..", "..");
const out = path.join(app, "build");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Electron main and preload: CommonJS (the preload runs sandboxed).
await build({
  entryPoints: { main: path.join(app, "src/main.ts"), preload: path.join(app, "src/preload.ts") },
  outdir: out,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
  logLevel: "warning",
});

// The server, bundled so the installer needs no node_modules.
await build({
  entryPoints: [path.join(repo, "apps/server/src/main.ts")],
  outfile: path.join(out, "server/main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Some dependencies are CommonJS and call require().
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  sourcemap: true,
  logLevel: "warning",
});
await cp(path.join(repo, "apps/server/src/agent/system-prompt.md"), path.join(out, "server/system-prompt.md"));
await cp(path.join(app, "src/setup"), path.join(out, "setup"), { recursive: true });

console.log("desktop build ready:", path.relative(repo, out));

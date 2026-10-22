/**
 * Builds everything the desktop app needs into apps/desktop/build:
 *
 *   build/main.cjs, build/preload.cjs   Electron main process and the web UI's preload
 *   build/terminal-preload.cjs          preload of the terminal panel
 *   build/setup/                        the connection settings page
 *   build/terminal/                     the terminal panel page (xterm.js)
 *   build/node_modules/node-pty/        real shells for the terminal (native, prebuilt)
 *   build/server/main.mjs               the whole harness server in one file
 *   build/server/system-prompt.md       read next to the server bundle
 *
 * The web UI (apps/web/dist) and docs/ are added by electron-builder.
 * Usage: node scripts/build.mjs
 */
import { build } from "esbuild";
import { chmod, cp, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const app = path.resolve(here, "..");
const repo = path.resolve(app, "..", "..");
const out = path.join(app, "build");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Electron main and preload: CommonJS (the preload runs sandboxed).
await build({
  entryPoints: {
    main: path.join(app, "src/main.ts"),
    preload: path.join(app, "src/preload.ts"),
    "terminal-preload": path.join(app, "src/terminal-preload.ts"),
  },
  outdir: out,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron", "node-pty"],
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

// The terminal panel page: xterm.js bundled for the browser.
await build({
  entryPoints: [path.join(app, "src/terminal/terminal.ts")],
  outfile: path.join(out, "terminal/terminal.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome140",
  logLevel: "warning",
});
const require = createRequire(import.meta.url);
const xtermDir = path.dirname(require.resolve("@xterm/xterm/package.json"));
await cp(path.join(xtermDir, "css/xterm.css"), path.join(out, "terminal/xterm.css"));
for (const file of ["index.html", "terminal.css"]) await cp(path.join(app, "src/terminal", file), path.join(out, "terminal", file));

// node-pty with its prebuilt binaries (macOS and Windows), next to main.cjs.
// pnpm skips its install script, so the macOS helper is made executable here.
const ptyDir = path.dirname(require.resolve("node-pty/package.json"));
const ptyOut = path.join(out, "node_modules/node-pty");
await cp(path.join(ptyDir, "package.json"), path.join(ptyOut, "package.json"));
await cp(path.join(ptyDir, "lib"), path.join(ptyOut, "lib"), { recursive: true, filter: (f) => !f.endsWith(".map") && !f.endsWith(".test.js") });
await cp(path.join(ptyDir, "prebuilds"), path.join(ptyOut, "prebuilds"), { recursive: true, filter: (f) => !f.endsWith(".pdb") });
for (const dir of await readdir(path.join(ptyOut, "prebuilds"))) {
  if (dir.startsWith("darwin")) await chmod(path.join(ptyOut, "prebuilds", dir, "spawn-helper"), 0o755);
}

console.log("desktop build ready:", path.relative(repo, out));

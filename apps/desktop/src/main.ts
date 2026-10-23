/**
 * Simha desktop app (Electron).
 *
 * One window with two views:
 * - the app view: the harness web UI, from a server on the hospital network
 *   ("remote") or from a server this app starts on the PC ("local"), or the
 *   setup page when nothing is set up or the server cannot be reached;
 * - the terminal panel (Ctrl+`), a page built into the app that runs real
 *   shells on this PC.
 *
 * The web UI gets a small bridge (window.simhaDesktop): Buka di Khanza,
 * open the terminal panel. It can never type into a shell; only the terminal
 * panel page can.
 */
import {
  app,
  BaseWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import path from "node:path";
import { FORM_FIELDS, formProblems } from "@simha/shared/forms";
import { fillKhanza, isLauncher, openKhanza, type KhanzaExit } from "./khanza.ts";
import { parseTarget, pingBridge } from "./khanza-bridge.ts";
import { createTerminal, killAllTerminals, killTerminal, resizeTerminal, startFolder, writeTerminal, type TerminalKind } from "./pty.ts";
import { checkServer, ensureEnvFile, serverLogTail, startLocalServer, stopLocalServer } from "./server.ts";
import { dataDir, loadSettings, migrateDataDir, normalizeServerUrl, saveSettings, type DesktopSettings } from "./settings.ts";

// Before "ready": decides the app data folder (%APPDATA%\Simha).
app.setName("Simha");
// Tests and trials can use a separate data folder (settings, .env, audit DB).
const dataDirOverride = process.env["SIMHA_DESKTOP_DATA_DIR"] ?? process.env["SIMRS_DESKTOP_DATA_DIR"];
if (dataDirOverride) {
  app.setPath("userData", dataDirOverride);
} else {
  const next = path.join(app.getPath("appData"), "Simha");
  app.setPath("userData", next);
  // Simha used to be called "SIMRS Harness": keep the old data on first start.
  migrateDataDir(next, path.join(app.getPath("appData"), "SIMRS Harness"));
}
if (process.platform === "win32") app.setAppUserModelId("id.simha.app");

let win: BaseWindow | null = null;
let appView: WebContentsView | null = null;
let terminalView: WebContentsView | null = null;
let terminalOpen = false;
let terminalHeight = 300;
/** Commands for the terminal page sent before it finished loading. */
let terminalQueue: Array<{ open?: TerminalKind; focus?: boolean }> = [];
let terminalReady = false;

/** Origin of the UI currently shown (null while the setup page is shown). */
let appOrigin: string | null = null;
/** Why the setup page is shown (connection failed, server stopped…). */
let setupError: string | null = null;

const buildFile = (...parts: Array<string>) => path.join(app.getAppPath(), "build", ...parts);
const khanzaLog = () => path.join(dataDir(), "logs", "khanza.log");
const isLocalPage = (url: string, page: string) => url.startsWith("file:") && url.replaceAll("\\", "/").endsWith(`/${page}/index.html`);
const isSetupUrl = (url: string) => isLocalPage(url, "setup");
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const secureWebPreferences = (preload: string) => ({
  preload: buildFile(preload),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false,
});

// --- Layout -------------------------------------------------------------------------------------

const MIN_TERMINAL = 120;
const MIN_APP = 240;

const layout = () => {
  if (!win || !appView) return;
  const { width, height } = win.getContentBounds();
  const term = terminalOpen && terminalView ? Math.max(MIN_TERMINAL, Math.min(terminalHeight, height - MIN_APP)) : 0;
  appView.setBounds({ x: 0, y: 0, width, height: height - term });
  if (terminalView) {
    terminalView.setVisible(term > 0);
    terminalView.setBounds({ x: 0, y: height - term, width, height: term });
  }
};

// --- App view: setup page or harness UI ---------------------------------------------------------

const showSetup = async (error: string | null) => {
  setupError = error;
  appOrigin = null;
  await appView?.webContents.loadFile(buildFile("setup", "index.html"));
};

/** Opens the harness UI for the saved settings, or the setup page. */
const connect = async () => {
  const settings = loadSettings();
  if (!settings.mode) return showSetup(null);
  try {
    let url: string;
    if (settings.mode === "local") {
      url = await startLocalServer(settings.port);
    } else {
      const check = await checkServer(settings.serverUrl);
      if (!check.ok) throw new Error(`${settings.serverUrl}: ${check.message}`);
      url = settings.serverUrl;
    }
    appOrigin = originOf(url);
    setupError = null;
    await appView?.webContents.loadURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const log = settings.mode === "local" ? serverLogTail() : "";
    const hint = settings.mode === "local" ? "\n\nPeriksa file .env (koneksi Khanza DB dan AI), lalu klik Simpan & sambungkan." : "";
    await showSetup(log ? `${message}\n\n${log}${hint}` : `${message}${hint}`);
  }
};

const guardNavigation = (contents: WebContents) => {
  // Stay on the harness server; anything else opens in the normal browser.
  contents.on("will-navigate", (event, url) => {
    if (isSetupUrl(url) || (appOrigin && originOf(url) === appOrigin)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (appOrigin && originOf(url) === appOrigin) return { action: "allow" };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
};

// --- Terminal panel -----------------------------------------------------------------------------

const sendToTerminal = (command: { open?: TerminalKind; focus?: boolean }) => {
  if (terminalReady) terminalView?.webContents.send("terminal:command", command);
  else terminalQueue.push(command);
};

const ensureTerminalView = () => {
  if (terminalView || !win) return;
  terminalView = new WebContentsView({ webPreferences: secureWebPreferences("terminal-preload.cjs") });
  terminalView.setBackgroundColor("#141c1a");
  const contents = terminalView.webContents;
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("did-finish-load", () => {
    terminalReady = true;
    for (const command of terminalQueue) contents.send("terminal:command", command);
    terminalQueue = [];
  });
  contents.on("render-process-gone", () => {
    killAllTerminals();
    terminalReady = false;
    void contents.loadFile(buildFile("terminal", "index.html"));
  });
  win.contentView.addChildView(terminalView);
  void contents.loadFile(buildFile("terminal", "index.html"));
};

const showTerminal = (open?: TerminalKind) => {
  ensureTerminalView();
  terminalOpen = true;
  layout();
  terminalView?.webContents.focus();
  sendToTerminal(open ? { open } : { focus: true });
};

const hideTerminal = () => {
  terminalOpen = false;
  layout();
  appView?.webContents.focus();
};

const toggleTerminal = () => (terminalOpen ? hideTerminal() : showTerminal());

// --- Window -------------------------------------------------------------------------------------

const createWindow = () => {
  win = new BaseWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    title: "Simha",
    backgroundColor: "#fffdf8",
    autoHideMenuBar: process.platform !== "darwin",
    // macOS: no title bar; the window buttons sit in the sidebar's top corner
    // and the page marks where the window can be dragged.
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
  });
  appView = new WebContentsView({ webPreferences: secureWebPreferences("preload.cjs") });
  appView.setBackgroundColor("#fffdf8");
  win.contentView.addChildView(appView);
  layout();
  win.on("resize", layout);
  win.on("closed", () => {
    killAllTerminals();
    win = null;
    appView = null;
    terminalView = null;
    terminalOpen = false;
    terminalReady = false;
    terminalQueue = [];
  });

  const contents = appView.webContents;
  guardNavigation(contents);
  // The server went away while the UI was open.
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || isSetupUrl(url)) return;
    void showSetup(`Tidak bisa membuka ${url}: ${description}`);
  });
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") void showSetup(`Tampilan berhenti (${details.reason}). Coba sambungkan lagi.`);
  });

  void connect();
};

// --- Bridge for the web UI and the setup page (window.simhaDesktop) ----------------------------

const fromAppView = (event: IpcMainInvokeEvent | IpcMainEvent) => appView !== null && event.sender === appView.webContents;
const fromSetup = (event: IpcMainInvokeEvent) => fromAppView(event) && isSetupUrl(event.senderFrame?.url ?? "");
const fromApp = (event: IpcMainInvokeEvent) => {
  const url = event.senderFrame?.url ?? "";
  return fromAppView(event) && (isSetupUrl(url) || (appOrigin !== null && originOf(url) === appOrigin));
};
const fromTerminal = (event: IpcMainInvokeEvent | IpcMainEvent) =>
  terminalView !== null && event.sender === terminalView.webContents && isLocalPage(event.senderFrame?.url ?? "", "terminal");
const refuse = () => {
  throw new Error("Tidak diizinkan dari halaman ini.");
};

const chooseLauncher = async (): Promise<string | null> => {
  const options: Electron.OpenDialogOptions = {
    title: "Pilih file untuk membuka Khanza",
    buttonLabel: "Pilih",
    properties: ["openFile"],
    filters: [
      { name: "Khanza (.bat, .cmd, .exe, .jar, .sh)", extensions: ["bat", "cmd", "exe", "jar", "sh", "command", "app"] },
      { name: "Semua file", extensions: ["*"] },
    ],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const file = result.filePaths[0];
  if (result.canceled || !file) return null;
  if (!isLauncher(file)) {
    void dialog.showMessageBox({ type: "warning", message: "Pilih file .bat, .cmd, .exe, .jar atau .sh yang biasa dipakai untuk membuka Khanza." });
    return null;
  }
  await saveSettings({ ...loadSettings(), khanzaLauncher: file });
  return file;
};

const publicInfo = () => {
  const s = loadSettings();
  return { version: app.getVersion(), platform: process.platform, mode: s.mode, serverUrl: s.serverUrl, port: s.port, khanzaLauncher: s.khanzaLauncher };
};

/** Khanza stopped right after a start: tell the web UI (it offers "Lihat output"). */
const reportKhanzaExit = (exit: KhanzaExit) => {
  if (appOrigin) appView?.webContents.send("desktop:khanzaExited", exit);
};

const registerIpc = () => {
  ipcMain.handle("desktop:info", (event) => (fromApp(event) ? publicInfo() : refuse()));
  ipcMain.handle("desktop:openKhanza", (event, copy: unknown, target: unknown) => {
    if (!fromApp(event)) return refuse();
    // Only short identifiers (no. rawat, no. RM) go to the clipboard, and only known forms to Khanza.
    const text = typeof copy === "string" && copy.length > 0 && copy.length <= 64 ? copy : null;
    return openKhanza(loadSettings().khanzaLauncher, text, { logFile: khanzaLog(), onEarlyExit: reportKhanzaExit }, parseTarget(target));
  });
  ipcMain.handle("desktop:fillKhanza", (event, input: unknown) => {
    if (!fromApp(event)) return refuse();
    // Only a known form, a real no. rawat and values within Khanza's limits go to Khanza.
    const { form, noRawat, fields } = (input ?? {}) as { form?: unknown; noRawat?: unknown; fields?: unknown };
    if (form !== "resume_ranap" || typeof noRawat !== "string" || !/^\d{4}\/\d{2}\/\d{2}\/\d{6}$/.test(noRawat)) {
      return { status: "error", message: "Permintaan tidak valid." };
    }
    if (fields === null || typeof fields !== "object") return { status: "error", message: "Isi form tidak valid." };
    const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
    const problems = formProblems(form, values);
    if (problems.length > 0 || Object.keys(values).length > FORM_FIELDS[form].length) return { status: "error", message: problems.join(" ") };
    return fillKhanza(loadSettings().khanzaLauncher, { logFile: khanzaLog(), onEarlyExit: reportKhanzaExit }, { form, noRawat, fields: values });
  });
  ipcMain.handle("desktop:khanzaBridge", async (event) => (fromApp(event) ? { user: await pingBridge() } : refuse()));
  ipcMain.handle("desktop:chooseKhanzaLauncher", (event) => (fromApp(event) ? chooseLauncher() : refuse()));
  ipcMain.handle("desktop:openSetup", (event) => (fromApp(event) ? showSetup(null) : refuse()));
  ipcMain.handle("desktop:toggleTerminal", (event) => (fromApp(event) ? toggleTerminal() : refuse()));
  ipcMain.handle("desktop:showKhanzaOutput", (event) => (fromApp(event) ? showTerminal("khanza-log") : refuse()));

  ipcMain.handle("setup:state", async (event) => {
    if (!fromSetup(event)) return refuse();
    return { ...publicInfo(), error: setupError, envFile: await ensureEnvFile().catch(() => null), packaged: app.isPackaged };
  });
  ipcMain.handle("setup:testServer", (event, url: unknown) => {
    if (!fromSetup(event)) return refuse();
    const normalized = normalizeServerUrl(String(url ?? ""));
    return normalized ? checkServer(normalized) : { ok: false, message: "Alamat server tidak valid. Contoh: http://10.0.0.5:8787" };
  });
  ipcMain.handle("setup:save", async (event, input: unknown) => {
    if (!fromSetup(event)) return refuse();
    const raw = (input ?? {}) as Partial<Record<keyof DesktopSettings, unknown>>;
    const current = loadSettings();
    const mode = raw.mode === "local" || raw.mode === "remote" ? raw.mode : current.mode;
    const serverUrl = mode === "remote" ? normalizeServerUrl(String(raw.serverUrl ?? "")) : current.serverUrl;
    if (mode === "remote" && !serverUrl) return { ok: false, message: "Alamat server tidak valid. Contoh: http://10.0.0.5:8787" };
    const port = Number(raw.port ?? current.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, message: "Port harus 1024–65535." };
    if (mode !== "local" || port !== current.port) stopLocalServer();
    await saveSettings({ ...current, mode, serverUrl: serverUrl ?? "", port });
    void connect();
    return { ok: true, message: "Menyambungkan…" };
  });
  ipcMain.handle("setup:openConfigFolder", async (event) => {
    if (!fromSetup(event)) return refuse();
    const file = await ensureEnvFile();
    shell.showItemInFolder(file);
  });

  // --- Terminal panel page only ---
  ipcMain.handle("terminal:create", async (event, kind: unknown, cols: unknown, rows: unknown) => {
    if (!fromTerminal(event)) return refuse();
    const which: TerminalKind = kind === "khanza-log" ? "khanza-log" : "shell";
    const contents = event.sender;
    const id = await createTerminal(
      which,
      { cols: Number(cols) || 80, rows: Number(rows) || 24 },
      { cwd: startFolder(loadSettings().khanzaLauncher), logFile: khanzaLog() },
      {
        data: (termId, data) => {
          if (!contents.isDestroyed()) contents.send("terminal:data", termId, data);
        },
        exit: (termId, code) => {
          if (!contents.isDestroyed()) contents.send("terminal:exit", termId, code);
        },
      },
    );
    const title = process.platform === "win32" ? "PowerShell" : path.basename(process.env["SHELL"] || "zsh");
    return { id, title };
  });
  ipcMain.on("terminal:write", (event, id: unknown, data: unknown) => {
    if (fromTerminal(event) && typeof id === "number" && typeof data === "string") writeTerminal(id, data);
  });
  ipcMain.on("terminal:resize", (event, id: unknown, cols: unknown, rows: unknown) => {
    if (fromTerminal(event) && typeof id === "number") resizeTerminal(id, Number(cols), Number(rows));
  });
  ipcMain.on("terminal:kill", (event, id: unknown) => {
    if (fromTerminal(event) && typeof id === "number") killTerminal(id);
  });
  ipcMain.on("terminal:height", (event, height: unknown) => {
    if (!fromTerminal(event) || typeof height !== "number" || !Number.isFinite(height)) return;
    terminalHeight = Math.round(height);
    layout();
  });
  ipcMain.on("terminal:hide", (event) => {
    if (fromTerminal(event)) hideTerminal();
  });
};

// --- Menu -------------------------------------------------------------------------------------

const buildMenu = () => {
  const template: Array<MenuItemConstructorOptions> = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "Aplikasi",
      submenu: [
        { label: "Pengaturan koneksi…", click: () => void showSetup(null) },
        { label: "Pilih file Khanza…", click: () => void chooseLauncher() },
        { type: "separator" },
        { label: "Terminal", accelerator: "Ctrl+`", click: toggleTerminal },
        { label: "Output Khanza", click: () => showTerminal("khanza-log") },
        { type: "separator" },
        { label: "Muat ulang", accelerator: "CmdOrCtrl+R", click: () => appView?.webContents.reload() },
        { label: "Developer tools", accelerator: "CmdOrCtrl+Alt+I", click: () => appView?.webContents.toggleDevTools() },
        { type: "separator" },
        { role: "quit", label: "Keluar" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Tampilan",
      submenu: [
        { label: "Perbesar", accelerator: "CmdOrCtrl+=", click: () => appView?.webContents.setZoomLevel(appView.webContents.getZoomLevel() + 0.5) },
        { label: "Perkecil", accelerator: "CmdOrCtrl+-", click: () => appView?.webContents.setZoomLevel(appView.webContents.getZoomLevel() - 0.5) },
        { label: "Ukuran normal", accelerator: "CmdOrCtrl+0", click: () => appView?.webContents.setZoomLevel(0) },
        { type: "separator" },
        { role: "togglefullscreen", label: "Layar penuh" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

// --- Lifecycle ----------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    registerIpc();
    buildMenu();
    createWindow();
    app.on("activate", () => {
      if (BaseWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    killAllTerminals();
    stopLocalServer();
  });
}

/**
 * SIMRS Harness desktop app (Electron).
 *
 * One window that shows the harness web UI, either from a server on the
 * hospital network ("remote") or from a server this app starts on the PC
 * ("local"). When nothing is set up, or the server cannot be reached, it
 * shows the setup page instead. The UI gets a small bridge
 * (window.simrsDesktop) for "Buka di Khanza".
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { isLauncher, openKhanza } from "./khanza.ts";
import { checkServer, ensureEnvFile, serverLogTail, startLocalServer, stopLocalServer } from "./server.ts";
import { loadSettings, normalizeServerUrl, saveSettings, type DesktopSettings } from "./settings.ts";

// Before "ready": decides the app data folder (%APPDATA%\SIMRS Harness).
app.setName("SIMRS Harness");
// Tests and trials can use a separate data folder (settings, .env, audit DB).
if (process.env["SIMRS_DESKTOP_DATA_DIR"]) app.setPath("userData", process.env["SIMRS_DESKTOP_DATA_DIR"]);
if (process.platform === "win32") app.setAppUserModelId("id.simrs.harness");

let win: BrowserWindow | null = null;
/** Origin of the UI currently shown (null while the setup page is shown). */
let appOrigin: string | null = null;
/** Why the setup page is shown (connection failed, server stopped…). */
let setupError: string | null = null;

const setupPage = () => path.join(app.getAppPath(), "build", "setup", "index.html");
const isSetupUrl = (url: string) => url.startsWith("file:") && url.replaceAll("\\", "/").endsWith("/setup/index.html");
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const showSetup = async (error: string | null) => {
  setupError = error;
  appOrigin = null;
  await win?.loadFile(setupPage());
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
    await win?.loadURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const log = settings.mode === "local" ? serverLogTail() : "";
    const hint = settings.mode === "local" ? "\n\nPeriksa file .env (koneksi Khanza DB dan AI), lalu klik Simpan & sambungkan." : "";
    await showSetup(log ? `${message}\n\n${log}${hint}` : `${message}${hint}`);
  }
};

const createWindow = () => {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: "SIMRS Harness",
    backgroundColor: "#fffdf8",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(app.getAppPath(), "build", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });

  const contents = win.webContents;
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

// --- Bridge (window.simrsDesktop) ---------------------------------------------------------------

const fromOurWindow = (event: IpcMainInvokeEvent) => win !== null && event.sender === win.webContents;
const fromSetup = (event: IpcMainInvokeEvent) => fromOurWindow(event) && isSetupUrl(event.senderFrame?.url ?? "");
const fromApp = (event: IpcMainInvokeEvent) => {
  const url = event.senderFrame?.url ?? "";
  return fromOurWindow(event) && (isSetupUrl(url) || (appOrigin !== null && originOf(url) === appOrigin));
};
const refuse = () => {
  throw new Error("Tidak diizinkan dari halaman ini.");
};

const chooseLauncher = async (): Promise<string | null> => {
  const options: Electron.OpenDialogOptions = {
    title: "Pilih file untuk membuka Khanza",
    buttonLabel: "Pilih",
    properties: ["openFile"],
    filters: [
      { name: "Khanza (.bat, .cmd, .exe, .jar)", extensions: ["bat", "cmd", "exe", "jar", "sh", "command", "app"] },
      { name: "Semua file", extensions: ["*"] },
    ],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const file = result.filePaths[0];
  if (result.canceled || !file) return null;
  if (!isLauncher(file)) {
    void dialog.showMessageBox({ type: "warning", message: "Pilih file .bat, .cmd, .exe atau .jar yang biasa dipakai untuk membuka Khanza." });
    return null;
  }
  await saveSettings({ ...loadSettings(), khanzaLauncher: file });
  return file;
};

const publicInfo = () => {
  const s = loadSettings();
  return { version: app.getVersion(), platform: process.platform, mode: s.mode, serverUrl: s.serverUrl, port: s.port, khanzaLauncher: s.khanzaLauncher };
};

const registerIpc = () => {
  ipcMain.handle("desktop:info", (event) => (fromApp(event) ? publicInfo() : refuse()));
  ipcMain.handle("desktop:openKhanza", (event, copy: unknown) => {
    if (!fromApp(event)) return refuse();
    // Only short identifiers (no. rawat, no. RM) go to the clipboard.
    const text = typeof copy === "string" && copy.length > 0 && copy.length <= 64 ? copy : null;
    return openKhanza(loadSettings().khanzaLauncher, text);
  });
  ipcMain.handle("desktop:chooseKhanzaLauncher", (event) => (fromApp(event) ? chooseLauncher() : refuse()));
  ipcMain.handle("desktop:openSetup", (event) => {
    if (!fromApp(event)) return refuse();
    return showSetup(null);
  });

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
        { role: "reload", label: "Muat ulang" },
        { role: "toggleDevTools", label: "Developer tools" },
        { type: "separator" },
        { role: "quit", label: "Keluar" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
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
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopLocalServer);
}

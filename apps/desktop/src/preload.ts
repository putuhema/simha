/**
 * The only bridge between the web UI and the desktop app. The page gets
 * `window.simrsDesktop` with a few functions; it never gets Node or Electron.
 * The main process checks which page each call comes from.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("simrsDesktop", {
  /** "darwin", "win32"…: the page adjusts its layout (macOS has no title bar). */
  platform: process.platform,
  /** App version, platform and connection settings. */
  info: () => ipcRenderer.invoke("desktop:info"),
  /** Open a Khanza form for a visit (bridge), or bring Khanza to the front / start it; copies `copy`. */
  openKhanza: (copy?: string | null, target?: { form: string; value: string } | null) =>
    ipcRenderer.invoke("desktop:openKhanza", copy ?? null, target ?? null),
  /** Open Khanza's form for the visit filled with a draft (Khanza does not save it; the user does). */
  fillKhanza: (request: { form: string; noRawat: string; fields: Record<string, string> }) => ipcRenderer.invoke("desktop:fillKhanza", request),
  /** Is a logged-in Khanza with the bridge running? `user` is its login, or null. */
  khanzaBridge: () => ipcRenderer.invoke("desktop:khanzaBridge"),
  /** Pick the file that starts Khanza on this PC; resolves with the saved path or null. */
  chooseKhanzaLauncher: () => ipcRenderer.invoke("desktop:chooseKhanzaLauncher"),
  /** Show the connection settings page. */
  openSetup: () => ipcRenderer.invoke("desktop:openSetup"),
  /** Show or hide the terminal panel (the page cannot type into it). */
  toggleTerminal: () => ipcRenderer.invoke("desktop:toggleTerminal"),
  /** Open the terminal panel on the "Output Khanza" tab. */
  showKhanzaOutput: () => ipcRenderer.invoke("desktop:showKhanzaOutput"),
  /** Called when Khanza stops right after "Buka di Khanza" started it; returns an unsubscribe function. */
  onKhanzaExit: (callback: (exit: { seconds: number; code: number | null }) => void) => {
    const handler = (_event: IpcRendererEvent, exit: { seconds: number; code: number | null }) => callback(exit);
    ipcRenderer.on("desktop:khanzaExited", handler);
    return () => void ipcRenderer.removeListener("desktop:khanzaExited", handler);
  },

  // Setup page only (refused for the web UI).
  setup: {
    state: () => ipcRenderer.invoke("setup:state"),
    testServer: (url: string) => ipcRenderer.invoke("setup:testServer", url),
    save: (settings: unknown) => ipcRenderer.invoke("setup:save", settings),
    openConfigFolder: () => ipcRenderer.invoke("setup:openConfigFolder"),
  },
});

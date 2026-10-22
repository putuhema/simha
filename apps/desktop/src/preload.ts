/**
 * The only bridge between the web UI and the desktop app. The page gets
 * `window.simrsDesktop` with a few functions; it never gets Node or Electron.
 * The main process checks which page each call comes from.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("simrsDesktop", {
  /** App version, platform and connection settings. */
  info: () => ipcRenderer.invoke("desktop:info"),
  /** Bring Khanza to the front (or start it) and copy `copy` to the clipboard. */
  openKhanza: (copy?: string | null) => ipcRenderer.invoke("desktop:openKhanza", copy ?? null),
  /** Pick the file that starts Khanza on this PC; resolves with the saved path or null. */
  chooseKhanzaLauncher: () => ipcRenderer.invoke("desktop:chooseKhanzaLauncher"),
  /** Show the connection settings page. */
  openSetup: () => ipcRenderer.invoke("desktop:openSetup"),

  // Setup page only (refused for the web UI).
  setup: {
    state: () => ipcRenderer.invoke("setup:state"),
    testServer: (url: string) => ipcRenderer.invoke("setup:testServer", url),
    save: (settings: unknown) => ipcRenderer.invoke("setup:save", settings),
    openConfigFolder: () => ipcRenderer.invoke("setup:openConfigFolder"),
  },
});

/**
 * Bridge for the terminal panel page only (a page built into the app, never
 * the harness web UI). The main process also checks every call comes from it.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Kind = "shell" | "khanza-log";

const listen = <A extends Array<unknown>>(channel: string, callback: (...args: A) => void) => {
  const handler = (_event: IpcRendererEvent, ...args: Array<unknown>) => callback(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => void ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("simrsTerminal", {
  create: (kind: Kind, cols: number, rows: number): Promise<{ id: number; title: string }> =>
    ipcRenderer.invoke("terminal:create", kind, cols, rows),
  write: (id: number, data: string) => ipcRenderer.send("terminal:write", id, data),
  resize: (id: number, cols: number, rows: number) => ipcRenderer.send("terminal:resize", id, cols, rows),
  kill: (id: number) => ipcRenderer.send("terminal:kill", id),
  /** Drag the panel's top edge. */
  setHeight: (height: number) => ipcRenderer.send("terminal:height", height),
  hide: () => ipcRenderer.send("terminal:hide"),
  onData: (callback: (id: number, data: string) => void) => listen("terminal:data", callback),
  onExit: (callback: (id: number, code: number) => void) => listen("terminal:exit", callback),
  /** Requests from the main process: open a shell or the Khanza output tab, focus. */
  onCommand: (callback: (command: { open?: Kind; focus?: boolean }) => void) => listen("terminal:command", callback),
});

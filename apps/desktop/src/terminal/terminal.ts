/**
 * The terminal panel at the bottom of the desktop app: tabs of real shells
 * on this PC plus an "Output Khanza" tab, drawn with xterm.js. Runs in a page
 * built into the app; talks to the main process through window.simrsTerminal.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

type Kind = "shell" | "khanza-log";

interface Bridge {
  readonly create: (kind: Kind, cols: number, rows: number) => Promise<{ id: number; title: string }>;
  readonly write: (id: number, data: string) => void;
  readonly resize: (id: number, cols: number, rows: number) => void;
  readonly kill: (id: number) => void;
  readonly setHeight: (height: number) => void;
  readonly hide: () => void;
  readonly onData: (callback: (id: number, data: string) => void) => void;
  readonly onExit: (callback: (id: number, code: number) => void) => void;
  readonly onCommand: (callback: (command: { open?: Kind; focus?: boolean }) => void) => void;
}

interface Tab {
  readonly id: number;
  readonly kind: Kind;
  readonly term: Terminal;
  readonly fit: FitAddon;
  readonly screen: HTMLElement;
  readonly button: HTMLElement;
  ended: boolean;
}

const bridge = (window as unknown as { simrsTerminal: Bridge }).simrsTerminal;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const tabsBar = $("tabs");
const screens = $("screens");
const tabs = new Map<number, Tab>();
let active: number | null = null;
let shellCount = 0;
/** Output that arrived before its tab was registered (e.g. the first prompt). */
const early = new Map<number, string>();

const THEME = {
  background: "#141c1a",
  foreground: "#e8e2d4",
  cursor: "#5ee6d3",
  cursorAccent: "#141c1a",
  selectionBackground: "#5ee6d355",
  black: "#1b2522",
  brightBlack: "#5c6763",
  red: "#f07c6c",
  brightRed: "#ff9d8f",
  green: "#7bd88f",
  brightGreen: "#9ee6ad",
  yellow: "#e6c06b",
  brightYellow: "#f2d48e",
  blue: "#7aaee8",
  brightBlue: "#9cc4f0",
  magenta: "#c79be8",
  brightMagenta: "#d9b6f0",
  cyan: "#5ee6d3",
  brightCyan: "#8cf0e2",
  white: "#e8e2d4",
  brightWhite: "#ffffff",
};

const fitActive = () => {
  const tab = active === null ? undefined : tabs.get(active);
  if (!tab) return;
  try {
    tab.fit.fit();
  } catch {
    // Hidden or zero-sized: fit again when visible.
  }
};

const showEmpty = () => {
  if (tabs.size > 0 || screens.querySelector(".empty")) return;
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = "Klik + untuk membuka terminal.";
  screens.append(empty);
};

const select = (id: number) => {
  active = id;
  for (const tab of tabs.values()) {
    const on = tab.id === id;
    tab.screen.classList.toggle("on", on);
    tab.button.setAttribute("aria-selected", String(on));
  }
  requestAnimationFrame(() => {
    fitActive();
    tabs.get(id)?.term.focus();
  });
};

const close = (id: number) => {
  const tab = tabs.get(id);
  if (!tab) return;
  if (!tab.ended) bridge.kill(id);
  tab.term.dispose();
  tab.screen.remove();
  tab.button.remove();
  tabs.delete(id);
  if (active === id) {
    const next = [...tabs.keys()].at(-1);
    if (next === undefined) {
      active = null;
      showEmpty();
    } else {
      select(next);
    }
  }
};

const open = async (kind: Kind) => {
  screens.querySelector(".empty")?.remove();
  const screen = document.createElement("div");
  screen.className = "screen on";
  screens.append(screen);
  const term = new Terminal({
    theme: THEME,
    fontFamily: '"IBM Plex Mono", Menlo, Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: kind === "shell",
    disableStdin: kind === "khanza-log",
    scrollback: 5000,
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  try {
    fit.fit();
  } catch {
    // Fitted again once the tab is shown.
  }

  let created: { id: number; title: string };
  try {
    created = await bridge.create(kind, term.cols, term.rows);
  } catch (error) {
    term.write(`\r\n  ${error instanceof Error ? error.message.replace(/^.*Error: /, "") : String(error)}\r\n`);
    return;
  }
  const label = kind === "khanza-log" ? "Output Khanza" : `${created.title}${++shellCount > 1 ? ` ${shellCount}` : ""}`;
  const button = document.createElement("div");
  button.className = "tab";
  button.setAttribute("role", "tab");
  button.title = label;
  button.innerHTML = `<span></span><button class="close" title="Tutup" aria-label="Tutup">×</button>`;
  (button.firstElementChild as HTMLElement).textContent = label;
  button.addEventListener("click", () => select(created.id));
  button.querySelector(".close")?.addEventListener("click", (event) => {
    event.stopPropagation();
    close(created.id);
  });
  tabsBar.append(button);

  const tab: Tab = { id: created.id, kind, term, fit, screen, button, ended: false };
  tabs.set(created.id, tab);
  const buffered = early.get(created.id);
  if (buffered) term.write(buffered);
  early.delete(created.id);
  term.onData((data) => {
    if (!tab.ended) bridge.write(created.id, data);
  });
  term.onResize(({ cols, rows }) => bridge.resize(created.id, cols, rows));
  select(created.id);
};

/** Shows an existing tab of this kind (the Khanza output), or opens one. */
const openOrSelect = (kind: Kind) => {
  const existing = [...tabs.values()].find((t) => t.kind === kind && !t.ended);
  if (existing) select(existing.id);
  else void open(kind);
};

bridge.onData((id, data) => {
  const tab = tabs.get(id);
  if (tab) tab.term.write(data);
  else early.set(id, (early.get(id) ?? "") + data);
});
bridge.onExit((id, code) => {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.ended = true;
  tab.button.classList.add("ended");
  tab.term.write(`\r\n\x1b[2m[selesai, kode ${code}. Tutup tab ini atau klik + untuk terminal baru]\x1b[0m\r\n`);
});
bridge.onCommand((command) => {
  if (command.open) openOrSelect(command.open);
  else if (tabs.size === 0) void open("shell");
  else if (command.focus && active !== null) select(active);
});

$("newShell").addEventListener("click", () => void open("shell"));
$("khanzaLog").addEventListener("click", () => openOrSelect("khanza-log"));
$("hide").addEventListener("click", () => bridge.hide());

new ResizeObserver(() => fitActive()).observe(screens);

// Drag the top edge to change the panel height.
$("grip").addEventListener("mousedown", (down) => {
  down.preventDefault();
  const startY = down.screenY;
  const startHeight = window.innerHeight;
  document.body.classList.add("dragging");
  const move = (event: MouseEvent) => bridge.setHeight(startHeight + (startY - event.screenY));
  const up = () => {
    document.body.classList.remove("dragging");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
});

showEmpty();

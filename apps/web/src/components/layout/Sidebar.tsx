/**
 * The left sidebar, in the style of a chat app: new chat, search, Tiket,
 * saved favorites and recent conversations, with the user menu at the
 * bottom. Collapses to an icon rail on a wide window and is a drawer on a
 * phone.
 */
import { Menu } from "@base-ui/react/menu";
import type { ConversationSummary, Favorite, Stats } from "@simrs/shared";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronRight,
  FileClock,
  KeyRound,
  LogOut,
  MessageSquare,
  MonitorCog,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  SquareTerminal,
  SquarePen,
  Star,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { desktop } from "../../lib/desktop.ts";
import { useApi } from "../../lib/useApi.ts";
import { useAuth } from "../../stores/auth.ts";
import { bumpFavorites, useVersions } from "../../stores/refresh.ts";
import { useSidebar } from "../../stores/sidebar.ts";
import { useTanya } from "../../stores/tanya.ts";
import { TipButton } from "../ui/Tip.tsx";

export interface Health {
  readonly khanza: { readonly readOnly: boolean; readonly server: { readonly flavor: string; readonly version: string } };
  readonly llm: { readonly provider: string; readonly model: string; readonly maskPii: boolean };
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** "⇧⌘S" on a Mac, "Ctrl+Shift+S" elsewhere. */
const shortcutLabel = (key: string) => (isMac ? `⇧⌘${key}` : `Ctrl+Shift+${key}`);

/** Starts a fresh Tanya Data thread. */
export const useNewChat = () => {
  const navigate = useNavigate();
  const reset = useTanya((s) => s.reset);
  // Clear ?c= first, or the old thread would be reopened from the URL.
  return () => void navigate({ to: "/tanya", search: {} }).then(reset);
};

const itemClass =
  "group flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink";
const activeClass = "bg-paper-2 font-medium text-ink";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

const Avatar = ({ name, className }: { readonly name: string; readonly className?: string }) => (
  <span className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-teal-2 text-[11px] font-semibold text-paper", className)}>
    {initials(name)}
  </span>
);

const ConnectionLine = ({ health, error }: { readonly health: Health | undefined; readonly error: string | null }) => (
  <div className="flex items-center gap-2 px-2 text-[12px] text-ink-3" title={health?.khanza.server.version}>
    <span className={cn("size-2 shrink-0 rounded-full", error ? "bg-red" : health ? "animate-pulse-led bg-led" : "bg-line")} />
    <span className="truncate">
      {error ? "Server tidak terhubung" : health ? `Khanza DB terhubung · ${health.khanza.readOnly ? "read-only" : "BISA MENULIS"}` : "Memeriksa…"}
    </span>
  </div>
);

const menuItem = "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-paper-2";

/** Avatar button at the bottom of the sidebar: account, settings, log out. */
const UserMenu = ({ compact, health, onNavigate }: { readonly compact: boolean; readonly health: Health | undefined; readonly onNavigate: () => void }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const go = (tab: "ai" | "audit" | "akun" | "desktop") => {
    onNavigate();
    void navigate({ to: "/pengaturan", search: { tab } });
  };
  return (
    <Menu.Root>
      <Menu.Trigger
        data-testid="user-menu"
        aria-label={`Menu akun ${user.displayName}`}
        className={cn(
          "flex items-center gap-2.5 rounded-lg text-left text-[13.5px] transition-colors hover:bg-paper-2 data-[popup-open]:bg-paper-2",
          compact ? "size-10 justify-center" : "w-full px-2 py-1.5",
        )}
      >
        <Avatar name={user.displayName} />
        {compact ? null : (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{user.displayName}</span>
            <span className="block truncate text-[11.5px] text-ink-3">{user.role === "admin" ? "Admin" : "Staf IT"}</span>
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Menu.Popup className="min-w-60 origin-[var(--transform-origin)] rounded-xl border border-line bg-card p-1.5 text-[13.5px] shadow-[0_16px_40px_-16px_rgb(23_32_30/0.35)] transition-[opacity,transform] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <Avatar name={user.displayName} />
              <div className="min-w-0">
                <p className="truncate font-medium">{user.displayName}</p>
                <p className="truncate font-mono text-[11.5px] text-ink-3">
                  {user.username} · {user.role === "admin" ? "admin" : "staf IT"}
                </p>
              </div>
            </div>
            {health ? (
              <p className="truncate px-2.5 pb-2 font-mono text-[11px] text-ink-3" title={health.llm.maskPii ? "Data pribadi disamarkan sebelum dikirim ke AI" : "Data tidak disamarkan (model lokal)"}>
                AI: {health.llm.provider} · {health.llm.model}
              </p>
            ) : null}
            <Menu.Separator className="my-1 h-px bg-line-2" />
            <Menu.Item className={menuItem} onClick={() => go("ai")}>
              <Settings className="size-4 text-ink-2" /> Pengaturan
              <kbd className="ml-auto font-sans text-[11.5px] text-ink-3">{isMac ? "⌘," : "Ctrl+,"}</kbd>
            </Menu.Item>
            <Menu.Item className={menuItem} onClick={() => go("audit")}>
              <FileClock className="size-4 text-ink-2" /> Audit log
            </Menu.Item>
            <Menu.Item className={menuItem} onClick={() => go("akun")}>
              <KeyRound className="size-4 text-ink-2" /> Akun & password
            </Menu.Item>
            {desktop ? (
              <Menu.Item className={menuItem} onClick={() => go("desktop")}>
                <MonitorCog className="size-4 text-ink-2" /> Desktop & Khanza
              </Menu.Item>
            ) : null}
            <Menu.Separator className="my-1 h-px bg-line-2" />
            <Menu.Item className={cn(menuItem, "text-red data-[highlighted]:bg-red-soft")} onClick={() => void logout()}>
              <LogOut className="size-4" /> Keluar
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

/** A collapsible group of links ("Favorit", "Percakapan"). */
const Section = ({ title, children, empty }: { readonly title: string; readonly children: ReactNode; readonly empty?: string | null }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex w-full items-center gap-1 px-2 pb-1 text-[12px] font-medium text-ink-3 hover:text-ink-2"
      >
        {title}
        <ChevronRight className={cn("size-3 opacity-0 transition-[transform,opacity] group-hover:opacity-100", open && "rotate-90")} />
      </button>
      {open ? (empty ? <p className="px-2 py-1 text-[12.5px] text-ink-3">{empty}</p> : children) : null}
    </section>
  );
};

const matches = (text: string, query: string) => query === "" || text.toLowerCase().includes(query.toLowerCase());

interface PanelProps {
  readonly health: Health | undefined;
  readonly healthError: string | null;
  readonly stats: Stats | undefined;
  /** Called after any navigation (closes the phone drawer). */
  readonly onNavigate: () => void;
  /** The close button: collapse to the rail, or close the drawer. */
  readonly onClose: () => void;
  readonly closeLabel: string;
}

/** The full sidebar. */
export const SidebarPanel = ({ health, healthError, stats, onNavigate, onClose, closeLabel }: PanelProps) => {
  const navigate = useNavigate();
  const newChat = useNewChat();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as { c?: string } });
  const versions = useVersions();
  const conversations = useApi<ReadonlyArray<ConversationSummary>>("/api/conversations?mine=1");
  const favorites = useApi<ReadonlyArray<Favorite>>("/api/favorites");
  const { conversationId, runFavorite, running } = useTanya();
  const { searching, startSearch, stopSearch } = useSidebar();
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);

  const reloadConversations = conversations.reload;
  const reloadFavorites = favorites.reload;
  useEffect(() => {
    if (versions.conversations > 0) void reloadConversations();
  }, [versions.conversations, reloadConversations]);
  useEffect(() => {
    if (versions.favorites > 0) void reloadFavorites();
  }, [versions.favorites, reloadFavorites]);
  useEffect(() => {
    if (searching) searchBox.current?.focus();
  }, [searching]);

  const closeSearch = () => {
    setQuery("");
    stopSearch();
  };
  const activeChat = pathname === "/tanya" ? (search.c ?? conversationId) : null;
  const favoriteList = (favorites.data ?? []).filter((f) => matches(`${f.judul} ${f.question}`, query));
  const chatList = (conversations.data ?? []).filter((c) => matches(c.firstQuestion, query));

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-3">
        <Link to="/tanya" onClick={onNavigate} className="flex min-w-0 items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="truncate font-display text-[16px] font-semibold tracking-tight">SIMRS Harness</span>
        </Link>
        <TipButton
          label={closeLabel}
          shortcut={shortcutLabel("S")}
          onClick={onClose}
          className="ml-auto grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <PanelLeftClose className="size-[18px]" />
        </TipButton>
      </div>

      <nav className="shrink-0 space-y-0.5 px-2">
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            onNavigate();
            newChat();
          }}
        >
          <SquarePen className="size-4" /> Percakapan baru
          <kbd className="ml-auto font-sans text-[11px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">{shortcutLabel("O")}</kbd>
        </button>
        {searching ? (
          <div className="flex h-8 items-center gap-2 rounded-lg bg-paper-2 px-2">
            <Search className="size-4 shrink-0 text-ink-3" />
            <input
              ref={searchBox}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              placeholder="Cari percakapan…"
              aria-label="Cari percakapan"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3"
            />
            <button type="button" aria-label="Tutup pencarian" onClick={closeSearch} className="text-ink-3 hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <button type="button" className={itemClass} onClick={startSearch}>
            <Search className="size-4" /> Cari
          </button>
        )}
        {desktop ? (
          <button type="button" className={itemClass} onClick={() => void desktop?.toggleTerminal()}>
            <SquareTerminal className="size-4" /> Terminal
            <kbd className="ml-auto font-sans text-[11px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">Ctrl+`</kbd>
          </button>
        ) : null}
        <Link to="/tiket" onClick={onNavigate} className={itemClass} activeProps={{ className: activeClass }}>
          <Ticket className="size-4" /> Tiket
          {stats?.tiketTerbuka ? (
            <span className="ml-auto rounded-full bg-teal-soft px-1.5 font-mono text-[11px] font-medium text-teal" title="Tiket terbuka">
              {stats.tiketTerbuka}
            </span>
          ) : null}
        </Link>
      </nav>

      <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Section title="Favorit" empty={favorites.data && favoriteList.length === 0 ? (query ? "Tidak ada yang cocok." : "Belum ada. Simpan hasil dengan ☆.") : null}>
          <ul data-testid="favorites">
            {favoriteList.map((f) => (
              <li key={f.id} className="group/item relative">
                <button
                  type="button"
                  title={`${f.question}\n(jalankan lagi tanpa AI)`}
                  disabled={running}
                  onClick={() => {
                    onNavigate();
                    void navigate({ to: "/tanya", search: conversationId ? { c: conversationId } : {} }).then(() => runFavorite(f));
                  }}
                  className={cn(itemClass, "pr-8")}
                >
                  <Star className="size-3.5 shrink-0 fill-amber text-amber" />
                  <span className="truncate">{f.judul}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Hapus favorit ${f.judul}`}
                  onClick={() => void api.delete(`/api/favorites/${f.id}`).then(bumpFavorites)}
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-md text-ink-3 opacity-0 group-hover/item:opacity-100 hover:bg-card hover:text-red focus:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Percakapan" empty={conversations.data && chatList.length === 0 ? (query ? "Tidak ada yang cocok." : "Belum ada percakapan.") : null}>
          <ul data-testid="conversations">
            {chatList.slice(0, 50).map((c) => (
              <li key={c.id}>
                <Link
                  to="/tanya"
                  search={{ c: c.id }}
                  onClick={onNavigate}
                  title={c.firstQuestion}
                  className={cn(itemClass, "font-normal", c.id === activeChat && activeClass)}
                >
                  <span className="truncate">{c.firstQuestion}</span>
                  {c.id === conversationId && running ? <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-teal" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-line-2 p-2">
        <ConnectionLine health={health} error={healthError} />
        <UserMenu compact={false} health={health} onNavigate={onNavigate} />
      </div>
    </div>
  );
};

/** The collapsed sidebar: icons only. */
export const SidebarRail = ({ health, healthError, stats }: Pick<PanelProps, "health" | "healthError" | "stats">) => {
  const { toggle, startSearch } = useSidebar();
  const newChat = useNewChat();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const icon = "relative grid size-10 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink";
  return (
    <div className="flex h-full w-full flex-col items-center gap-1 py-1.5">
      <TipButton label="Buka sidebar" shortcut={shortcutLabel("S")} side="right" onClick={toggle} className={icon}>
        <PanelLeftOpen className="size-[18px]" />
      </TipButton>
      <TipButton label="Percakapan baru" shortcut={shortcutLabel("O")} side="right" onClick={newChat} className={icon}>
        <SquarePen className="size-[18px]" />
      </TipButton>
      <TipButton label="Cari" side="right" onClick={startSearch} className={icon}>
        <Search className="size-[18px]" />
      </TipButton>
      <TipButton label="Tanya Data" side="right" onClick={() => void navigate({ to: "/tanya" })} className={cn(icon, pathname === "/tanya" && "bg-paper-2 text-ink")}>
        <MessageSquare className="size-[18px]" />
      </TipButton>
      <TipButton label="Tiket" side="right" onClick={() => void navigate({ to: "/tiket" })} className={cn(icon, pathname === "/tiket" && "bg-paper-2 text-ink")}>
        <Ticket className="size-[18px]" />
        {stats?.tiketTerbuka ? <span className="absolute top-2 right-2 size-2 rounded-full bg-teal ring-2 ring-paper" /> : null}
      </TipButton>
      {desktop ? (
        <TipButton label="Terminal" shortcut="Ctrl+`" side="right" onClick={() => void desktop?.toggleTerminal()} className={icon}>
          <SquareTerminal className="size-[18px]" />
        </TipButton>
      ) : null}
      <div className="mt-auto flex flex-col items-center gap-2">
        <span
          title={healthError ? "Server tidak terhubung" : health ? "Khanza DB terhubung" : "Memeriksa…"}
          className={cn("size-2 rounded-full", healthError ? "bg-red" : health ? "animate-pulse-led bg-led" : "bg-line")}
        />
        <UserMenu compact health={health} onNavigate={() => undefined} />
      </div>
    </div>
  );
};

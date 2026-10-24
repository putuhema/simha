/**
 * The left sidebar: brand, one prominent "new chat" button, and the
 * conversation workspace with its threads (newest first, pinned on top),
 * then favorites and the archive. It collapses to an icon rail on a wide
 * window and becomes a drawer on a phone.
 */
import { Menu } from "@base-ui/react/menu";
import type { ConversationSummary, Favorite } from "@simha/shared";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  ChevronsUpDown,
  FileClock,
  KeyRound,
  LogOut,
  MonitorCog,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SquarePen,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { desktop } from "../../lib/desktop.ts";
import { formatAgo } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";
import { useAuth } from "../../stores/auth.ts";
import { bumpConversations, bumpFavorites, useVersions } from "../../stores/refresh.ts";
import { useSidebar } from "../../stores/sidebar.ts";
import { useTanya } from "../../stores/tanya.ts";
import { TipButton } from "../ui/Tip.tsx";

export interface Health {
  readonly khanza: { readonly readOnly: boolean; readonly server: { readonly flavor: string; readonly version: string } };
  readonly llm: { readonly provider: string; readonly model: string; readonly maskPii: boolean };
  /** Orthanc PACS configured (radiology images). */
  readonly pacs?: boolean;
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

const rowClass =
  "group flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink";
const activeClass = "bg-teal-soft font-medium text-teal-2";
const iconButton = "grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink";
const menuPopup =
  "min-w-52 origin-[var(--transform-origin)] rounded-xl border border-line bg-card p-1.5 text-[13px] text-ink shadow-[0_18px_44px_-20px_rgb(26_31_30/0.35)] transition-[opacity,transform] duration-150 ease-out outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:duration-[100ms] data-[starting-style]:scale-95 data-[starting-style]:opacity-0";
const menuItem = "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 outline-none data-[highlighted]:bg-paper-2";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

const Avatar = ({ name, className }: { readonly name: string; readonly className?: string }) => (
  <span className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-teal-2 text-[10.5px] font-semibold text-paper", className)}>{initials(name)}</span>
);

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
          "flex items-center gap-2 rounded-lg text-left text-[13px] transition-colors hover:bg-paper-2 data-[popup-open]:bg-paper-2",
          compact ? "size-9 justify-center" : "w-full px-1.5 py-1.5",
        )}
      >
        <Avatar name={user.displayName} />
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink">{user.displayName}</span>
              <span className="block truncate text-[11px] text-ink-3">{user.khanzaAdmin ? "Admin SIMRS" : "Pengguna SIMRS"}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" />
          </>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Menu.Popup className={menuPopup}>
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <Avatar name={user.displayName} />
              <div className="min-w-0">
                <p className="truncate font-medium">{user.displayName}</p>
                <p className="truncate font-mono text-[11px] text-ink-3">
                  {user.username} · {user.khanzaAdmin ? "Admin Utama SIMRS" : "pengguna SIMRS"}
                </p>
              </div>
            </div>
            {health ? (
              <p className="truncate px-2.5 pb-2 font-mono text-[10.5px] text-ink-3" title={health.llm.maskPii ? "Data pribadi disamarkan sebelum dikirim ke AI" : "Data tidak disamarkan (model lokal)"}>
                AI: {health.llm.provider} · {health.llm.model}
              </p>
            ) : null}
            <Menu.Separator className="my-1 h-px bg-line-2" />
            <Menu.Item className={menuItem} onClick={() => go("ai")}>
              <Settings className="size-4 text-ink-2" /> Pengaturan
              <kbd className="ml-auto font-sans text-[11px] text-ink-3">{isMac ? "⌘," : "Ctrl+,"}</kbd>
            </Menu.Item>
            <Menu.Item className={menuItem} onClick={() => go("audit")}>
              <FileClock className="size-4 text-ink-2" /> Audit log
            </Menu.Item>
            <Menu.Item className={menuItem} onClick={() => go("akun")}>
              <KeyRound className="size-4 text-ink-2" /> Akun & hak akses
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

/** A collapsible group of list rows (favorites, archive). */
const Section = ({
  title,
  children,
  empty,
  defaultOpen = true,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly empty?: string | null;
  readonly defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex w-full items-center gap-1 px-1.5 pb-1 text-[11.5px] font-medium text-ink-3 hover:text-ink-2"
      >
        {title}
        <ChevronRight className={cn("size-3 opacity-0 transition-[transform,opacity] group-hover:opacity-100", open && "rotate-90")} />
      </button>
      {open ? (empty ? <p className="px-1.5 py-1 text-[12px] text-ink-3">{empty}</p> : children) : null}
    </section>
  );
};

const matches = (text: string, query: string) => query === "" || text.toLowerCase().includes(query.toLowerCase());

interface ConversationRowProps {
  readonly conversation: ConversationSummary;
  readonly active: boolean;
  readonly running: boolean;
  readonly onNavigate: () => void;
  readonly onDeleted: (id: string) => void;
  readonly onError: (message: string | null) => void;
}

/** One thread: open it, or pin/archive/remove it from the ··· menu. */
const ConversationRow = ({ conversation, active, running, onNavigate, onDeleted, onError }: ConversationRowProps) => {
  const setFlags = (flags: { readonly pinned?: boolean; readonly archived?: boolean }) => {
    void api
      .patch(`/api/conversations/${conversation.id}`, flags)
      .then(() => {
        onError(null);
        bumpConversations();
      })
      .catch((error: unknown) => onError(errorMessage(error)));
  };
  const remove = () => {
    if (!window.confirm("Hapus percakapan ini? Pertanyaan dan jawabannya tidak bisa dibuka lagi.")) return;
    void api
      .delete(`/api/conversations/${conversation.id}`)
      .then(() => {
        onError(null);
        onDeleted(conversation.id);
        bumpConversations();
      })
      .catch((error: unknown) => onError(errorMessage(error)));
  };
  return (
    <li className="group/item relative">
      <Link
        to="/tanya"
        search={{ c: conversation.id }}
        onClick={onNavigate}
        title={conversation.firstQuestion}
        className={cn(rowClass, "pr-9 font-normal", active && activeClass)}
      >
        {conversation.pinned ? <Pin className="size-3 shrink-0 text-amber" aria-hidden /> : null}
        <span className="truncate">{conversation.firstQuestion}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-3 tabular-nums transition-opacity group-hover/item:opacity-0">
          {running ? <span className="inline-block size-1.5 animate-pulse rounded-full bg-teal" aria-label="Berjalan" /> : formatAgo(conversation.lastAt)}
        </span>
      </Link>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Aksi percakapan ${conversation.firstQuestion}`}
          className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 opacity-100 transition-colors hover:bg-card hover:text-ink focus:opacity-100 data-[popup-open]:bg-card data-[popup-open]:opacity-100 md:opacity-0 md:group-hover/item:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Menu.Popup className={menuPopup}>
              <Menu.Item className={menuItem} onClick={() => setFlags({ pinned: !conversation.pinned })}>
                {conversation.pinned ? <PinOff className="size-4 text-ink-2" /> : <Pin className="size-4 text-ink-2" />}
                {conversation.pinned ? "Lepas pin" : "Pin percakapan"}
              </Menu.Item>
              <Menu.Item className={menuItem} onClick={() => setFlags({ archived: !conversation.archived })}>
                {conversation.archived ? <ArchiveRestore className="size-4 text-ink-2" /> : <Archive className="size-4 text-ink-2" />}
                {conversation.archived ? "Keluarkan dari arsip" : "Arsipkan"}
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-line-2" />
              <Menu.Item className={cn(menuItem, "text-red data-[highlighted]:bg-red-soft")} onClick={remove}>
                <Trash2 className="size-4" /> Hapus percakapan
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </li>
  );
};

interface PanelProps {
  readonly health: Health | undefined;
  /** Called after any navigation (closes the phone drawer). */
  readonly onNavigate: () => void;
  /** The close button: collapse to the rail, or close the drawer. */
  readonly onClose: () => void;
  readonly closeLabel: string;
}

/** The full sidebar. */
export const SidebarPanel = ({ health, onNavigate, onClose, closeLabel }: PanelProps) => {
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(true);
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
  const conversationList = conversations.data ?? [];
  const chatList = conversationList.filter((c) => !c.archived && matches(c.firstQuestion, query));
  const archivedList = conversationList.filter((c) => c.archived && matches(c.firstQuestion, query));
  const conversationDeleted = (id: string) => {
    if (id === conversationId || id === search.c) newChat();
  };

  return (
    <div className="flex h-full w-full flex-col bg-card">
      {/* The toggle shares the traffic-light strip, so its position survives collapse. */}
      <div className="drag relative h-[var(--rail-inset,0px)] w-full shrink-0">
        <TipButton
          label={closeLabel}
          shortcut={shortcutLabel("S")}
          onClick={onClose}
          className={cn(iconButton, "no-drag absolute top-[var(--sidebar-toggle-top,0px)] left-[var(--sidebar-toggle-inset)] size-8")}
        >
          <PanelLeftClose className="size-4" />
        </TipButton>
      </div>
      <div className="drag flex shrink-0 items-center gap-1 pt-0.5 pr-2.5 pb-3 pl-2.5">
        <Link to="/tanya" onClick={onNavigate} className="no-drag flex w-fit min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-paper-2">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="truncate font-display text-[20px] leading-none font-semibold tracking-[-0.03em]">simha</span>
        </Link>
      </div>

      <div className="shrink-0 px-2.5">
        <button
          type="button"
          data-testid="new-chat"
          onClick={() => {
            onNavigate();
            newChat();
          }}
          className="group relative flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-card text-[13px] font-medium text-ink transition-[background-color,border-color,transform] duration-150 ease-out hover:border-ink-3/40 active:scale-[0.99]"
        >
          <Plus className="size-4 text-ink-2" />
          Percakapan baru
          <kbd className="absolute right-2 font-sans text-[10px] font-normal text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">{shortcutLabel("O")}</kbd>
        </button>
      </div>

      <div className="quiet-scroll mt-4 min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {/* The section label stays put while the list scrolls under it. */}
        <div className="sticky top-0 z-10 -mx-2.5 bg-paper px-2.5 pb-1">
          <div className="flex items-center justify-between pb-0.5">
            <button
              type="button"
              onClick={() => setSessionsOpen(!sessionsOpen)}
              aria-expanded={sessionsOpen}
              className="group flex items-center gap-1 px-1.5 py-0.5 text-[11.5px] font-medium text-ink-3 transition-colors hover:text-ink-2"
            >
              Percakapan
              <span className="font-mono text-[10px] font-normal text-ink-3 tabular-nums">{chatList.length}</span>
              <ChevronRight className={cn("size-3 opacity-0 transition-[transform,opacity] group-hover:opacity-100", sessionsOpen && "rotate-90")} />
            </button>
            {searching ? null : (
              <TipButton label="Cari percakapan" onClick={startSearch} className={cn(iconButton, "size-6")}>
                <Search className="size-3.5" />
              </TipButton>
            )}
          </div>

          {searching ? (
            <div className="mt-1 flex h-8 items-center gap-2 rounded-lg border border-line bg-card px-2">
              <Search className="size-3.5 shrink-0 text-ink-3" />
              <input
                ref={searchBox}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="Cari percakapan…"
                aria-label="Cari percakapan"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-ink-3"
              />
              <button type="button" aria-label="Tutup pencarian" onClick={closeSearch} className="text-ink-3 hover:text-ink">
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        {sessionsOpen ? (
          <>
            <ul data-testid="conversations" className="space-y-px">
              {chatList.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  active={c.id === activeChat}
                  running={c.id === conversationId && running}
                  onNavigate={onNavigate}
                  onDeleted={conversationDeleted}
                  onError={setActionError}
                />
              ))}
            </ul>
            {conversations.data && chatList.length === 0 ? (
              <p className="px-1.5 py-1 text-[12px] text-ink-3">{query ? "Tidak ada yang cocok." : "Belum ada percakapan."}</p>
            ) : null}
          </>
        ) : null}

        <Section
          title="Favorit"
          empty={favorites.data && favoriteList.length === 0 ? (query ? "Tidak ada yang cocok." : "Belum ada. Simpan hasil dengan ☆.") : null}
        >
          <ul data-testid="favorites" className="space-y-px">
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
                  className={cn(rowClass, "pr-8")}
                >
                  <Star className="size-3 shrink-0 fill-amber text-amber" />
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
        {actionError ? <p className="px-1.5 pb-1 text-[12px] text-red">{actionError}</p> : null}

        {archivedList.length > 0 ? (
          <Section title={`Arsip (${archivedList.length})`} defaultOpen={false}>
            <ul data-testid="archived-conversations" className="space-y-px">
              {archivedList.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  active={c.id === activeChat}
                  running={c.id === conversationId && running}
                  onNavigate={onNavigate}
                  onDeleted={conversationDeleted}
                  onError={setActionError}
                />
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line-2 p-2">
        <UserMenu compact={false} health={health} onNavigate={onNavigate} />
      </div>
    </div>
  );
};

/** The collapsed sidebar: icons only. */
export const SidebarRail = ({ health }: { readonly health: Health | undefined }) => {
  const { toggle, startSearch } = useSidebar();
  const newChat = useNewChat();
  const icon = "relative grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink";
  return (
    <div className="flex h-full w-full flex-col bg-card py-2">
      <div className="drag relative -mt-2 h-[var(--rail-inset,0px)] w-full shrink-0">
        <TipButton
          label="Buka sidebar"
          shortcut={shortcutLabel("S")}
          side="right"
          onClick={toggle}
          className={cn(iconButton, "no-drag absolute top-[var(--sidebar-toggle-top,0px)] left-[var(--sidebar-toggle-inset)] size-8")}
        >
          <PanelLeftOpen className="size-4" />
        </TipButton>
      </div>
      <div className="ml-[var(--sidebar-toggle-inset)] flex min-h-0 flex-1 flex-col items-center gap-0.5">
        <Link to="/tanya" aria-label="Simha" className="mb-1 grid size-9 place-items-center rounded-lg hover:bg-paper-2">
          <img src="/favicon.svg" alt="" className="size-[22px]" />
        </Link>
        <TipButton label="Percakapan baru" shortcut={shortcutLabel("O")} side="right" onClick={newChat} className={icon}>
          <SquarePen className="size-4" />
        </TipButton>
        <TipButton label="Cari" side="right" onClick={startSearch} className={icon}>
          <Search className="size-4" />
        </TipButton>
        <div className="mt-auto">
          <UserMenu compact health={health} onNavigate={() => undefined} />
        </div>
      </div>
    </div>
  );
};

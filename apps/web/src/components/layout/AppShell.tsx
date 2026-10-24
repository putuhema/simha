/**
 * App layout: sidebar on the left (full, icon rail, or a drawer on a phone)
 * and the current view filling the rest.
 *
 * Shortcuts: ⇧⌘S sidebar, ⇧⌘O new chat, ⌘, settings (Ctrl on Windows/Linux).
 */
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Menu as MenuIcon, SquarePen } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../../lib/cn.ts";
import { useApi } from "../../lib/useApi.ts";
import { useSidebar } from "../../stores/sidebar.ts";
import { KhanzaExitBanner } from "../desktop/KhanzaExitBanner.tsx";
import { TipButton, TipProvider } from "../ui/Tip.tsx";
import { SidebarPanel, SidebarRail, useNewChat, type Health } from "./Sidebar.tsx";

const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;

export const AppShell = () => {
  const health = useApi<Health>("/api/health", { refreshMs: 60_000 });
  const { open, drawer, toggle, setDrawer } = useSidebar();
  const newChat = useNewChat();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "s") {
        event.preventDefault();
        if (isWide()) toggle();
        else setDrawer(!useSidebar.getState().drawer);
      } else if (event.shiftKey && key === "o") {
        event.preventDefault();
        setDrawer(false);
        newChat();
      } else if (!event.shiftKey && key === ",") {
        event.preventDefault();
        void navigate({ to: "/pengaturan" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, setDrawer, newChat, navigate]);

  const shared = { health: health.data };

  return (
    <TipProvider>
      <div className="flex h-full overflow-hidden bg-card">
        {/* Wide window: full sidebar or icon rail. */}
        <aside
          aria-label="Sidebar"
          className={cn(
            "hidden h-full shrink-0 overflow-hidden bg-paper transition-[width] duration-200 ease-out md:block",
            open ? "w-[286px] border-r border-line-2" : "w-[var(--rail-width,64px)] border-r border-transparent",
          )}
        >
          {open ? (
            <div key="panel" className="h-full w-[286px] animate-fade-in">
              <SidebarPanel {...shared} onNavigate={() => undefined} onClose={toggle} closeLabel="Tutup sidebar" />
            </div>
          ) : (
            <div key="rail" className="h-full w-[var(--rail-width,64px)] animate-fade-in">
              <SidebarRail health={health.data} />
            </div>
          )}
        </aside>

        {/* Phone: drawer over the page. */}
        <div className={cn("fixed inset-0 z-40 md:hidden", drawer ? "" : "pointer-events-none")} aria-hidden={!drawer}>
          <div
            className={cn("absolute inset-0 bg-ink/30 backdrop-blur-[1px] transition-opacity duration-200", drawer ? "opacity-100" : "opacity-0")}
            onClick={() => setDrawer(false)}
          />
          <aside
            aria-label="Sidebar"
            className={cn(
              "absolute inset-y-0 left-0 w-[290px] max-w-[86vw] bg-paper shadow-2xl transition-transform duration-200 ease-out",
              drawer ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {drawer ? (
              <SidebarPanel {...shared} onNavigate={() => setDrawer(false)} onClose={() => setDrawer(false)} closeLabel="Tutup menu" />
            ) : null}
          </aside>
        </div>

        <main className="relative flex h-full min-w-0 flex-1 flex-col bg-card">
          {/* Desktop app on macOS: the top edge drags the window (there is no title bar). */}
          <div className="drag absolute inset-x-0 top-0 z-10 hidden h-3 [:root[data-desktop=darwin]_&]:block" />
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line-2 px-2 md:hidden">
            <TipButton label="Buka menu" onClick={() => setDrawer(true)} className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-paper-2">
              <MenuIcon className="size-5" />
            </TipButton>
            <span className="flex items-center gap-1.5">
              <img src="/favicon.svg" alt="" className="size-5" />
              <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">simha</span>
            </span>
            <TipButton label="Percakapan baru" onClick={newChat} className="ml-auto grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-paper-2">
              <SquarePen className="size-[18px]" />
            </TipButton>
          </div>
          <KhanzaExitBanner />
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </main>
      </div>
    </TipProvider>
  );
};

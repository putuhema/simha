/**
 * App layout: sidebar on the left (full, icon rail, or a drawer on a phone)
 * and the current view filling the rest.
 *
 * Shortcuts: ⇧⌘S sidebar, ⇧⌘O new chat, ⌘, settings (Ctrl on Windows/Linux).
 */
import type { Stats } from "@simrs/shared";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Menu as MenuIcon, SquarePen } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../../lib/cn.ts";
import { useApi } from "../../lib/useApi.ts";
import { useVersions } from "../../stores/refresh.ts";
import { useSidebar } from "../../stores/sidebar.ts";
import { KhanzaExitBanner } from "../desktop/KhanzaExitBanner.tsx";
import { TipButton, TipProvider } from "../ui/Tip.tsx";
import { SidebarPanel, SidebarRail, useNewChat, type Health } from "./Sidebar.tsx";

const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;

export const AppShell = () => {
  const health = useApi<Health>("/api/health", { refreshMs: 60_000 });
  const stats = useApi<Stats>("/api/stats", { refreshMs: 60_000 });
  const statsVersion = useVersions((v) => v.stats);
  const { open, drawer, toggle, setDrawer } = useSidebar();
  const newChat = useNewChat();
  const navigate = useNavigate();

  const reloadStats = stats.reload;
  useEffect(() => {
    if (statsVersion > 0) void reloadStats();
  }, [statsVersion, reloadStats]);

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

  const shared = { health: health.data, healthError: health.error, stats: stats.data };

  return (
    <TipProvider>
      <div className="flex h-full overflow-hidden bg-card">
        {/* Wide window: full sidebar or icon rail. */}
        <aside
          aria-label="Sidebar"
          className={cn(
            "hidden h-full shrink-0 overflow-hidden border-r border-line-2 bg-paper transition-[width] duration-200 ease-out md:block",
            open ? "w-[268px]" : "w-[60px]",
          )}
        >
          {open ? (
            <div key="panel" className="h-full w-[268px] animate-fade-in">
              <SidebarPanel {...shared} onNavigate={() => undefined} onClose={toggle} closeLabel="Tutup sidebar" />
            </div>
          ) : (
            <div key="rail" className="h-full w-[60px] animate-fade-in">
              <SidebarRail {...shared} />
            </div>
          )}
        </aside>

        {/* Phone: drawer over the page. */}
        <div className={cn("fixed inset-0 z-40 md:hidden", drawer ? "" : "pointer-events-none")} aria-hidden={!drawer}>
          <div
            className={cn("absolute inset-0 bg-ink/30 transition-opacity duration-200", drawer ? "opacity-100" : "opacity-0")}
            onClick={() => setDrawer(false)}
          />
          <aside
            aria-label="Sidebar"
            className={cn(
              "absolute inset-y-0 left-0 w-[284px] max-w-[85vw] bg-paper shadow-xl transition-transform duration-200 ease-out",
              drawer ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {drawer ? (
              <SidebarPanel {...shared} onNavigate={() => setDrawer(false)} onClose={() => setDrawer(false)} closeLabel="Tutup menu" />
            ) : null}
          </aside>
        </div>

        <main className="flex h-full min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line-2 px-2 md:hidden">
            <TipButton label="Buka menu" onClick={() => setDrawer(true)} className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-paper-2">
              <MenuIcon className="size-5" />
            </TipButton>
            <span className="font-display text-[15px] font-semibold">SIMRS Harness</span>
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

/**
 * Top bar (app name, Khanza connection, AI model, user), the stat row, the
 * view tabs, and the current view.
 */
import { Menu } from "@base-ui/react/menu";
import type { Stats } from "@simrs/shared";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { BedDouble, ChevronDown, ClipboardList, Database, LogOut, MessagesSquare, Settings, Ticket, UserRound, Wrench } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { formatNumber } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";
import { useAuth } from "../../stores/auth.ts";
import { useStatsVersion } from "../../stores/refresh.ts";

interface Health {
  readonly khanza: { readonly readOnly: boolean; readonly server: { readonly flavor: string; readonly version: string } };
  readonly llm: { readonly provider: string; readonly model: string; readonly maskPii: boolean };
}

const ConnectionIndicator = ({ health, error }: { readonly health: Health | undefined; readonly error: string | null }) => (
  <div className="flex items-center gap-2 text-[12.5px] text-paper/80" title={health?.khanza.server.version}>
    <span className={cn("size-2 rounded-full", error ? "bg-red" : health ? "animate-pulse-led bg-led" : "bg-paper/30")} />
    <span className="hidden sm:inline">
      {error ? "Server tidak terhubung" : health ? `Khanza DB terhubung · ${health.khanza.readOnly ? "read-only" : "BISA MENULIS"}` : "Memeriksa…"}
    </span>
  </div>
);

const UserMenu = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <Menu.Root>
      <Menu.Trigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-paper hover:bg-white/10" data-testid="user-menu">
        <UserRound className="size-4" />
        <span className="max-w-32 truncate">{user.displayName}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="min-w-52 rounded-lg border border-line bg-card p-1 text-[13px] shadow-[0_12px_32px_-12px_rgb(23_32_30/0.4)] outline-none">
            <div className="px-2.5 py-2">
              <p className="font-medium">{user.displayName}</p>
              <p className="font-mono text-[11.5px] text-ink-3">
                {user.username} · {user.role === "admin" ? "admin" : "staf IT"}
              </p>
            </div>
            <Menu.Separator className="my-1 h-px bg-line-2" />
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded px-2.5 py-1.5 outline-none data-[highlighted]:bg-paper-2"
              onClick={() => void navigate({ to: "/pengaturan", search: { tab: "akun" } })}
            >
              <Settings className="size-4" /> Akun & password
            </Menu.Item>
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded px-2.5 py-1.5 text-red outline-none data-[highlighted]:bg-red-soft"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" /> Keluar
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

const Stat = ({ icon, label, value, tone, hint }: { readonly icon: ReactNode; readonly label: string; readonly value: number | null | undefined; readonly tone?: "amber"; readonly hint?: string | undefined }) => (
  <div className="flex items-center gap-3 rounded-lg border border-line bg-card px-4 py-3" title={hint}>
    <span className={cn("grid size-9 place-items-center rounded-md", tone === "amber" && value ? "bg-amber-soft text-amber" : "bg-teal-soft text-teal")}>
      {icon}
    </span>
    <div className="min-w-0">
      <p className="font-display text-[24px] leading-none font-semibold tabular-nums">{value === undefined ? "…" : formatNumber(value)}</p>
      <p className="mt-1 truncate text-[12px] text-ink-2">{label}</p>
    </div>
  </div>
);

const NAV = [
  { to: "/tiket", label: "Tiket", icon: Ticket },
  { to: "/tanya", label: "Tanya Data", icon: MessagesSquare },
  { to: "/pengaturan", label: "Pengaturan", icon: Settings },
] as const;

export const AppShell = () => {
  const health = useApi<Health>("/api/health", { refreshMs: 60_000 });
  const stats = useApi<Stats>("/api/stats", { refreshMs: 60_000 });
  const version = useStatsVersion((v) => v.version);
  const reloadStats = stats.reload;
  useEffect(() => {
    if (version > 0) void reloadStats();
  }, [version, reloadStats]);
  const s = stats.data;
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 bg-teal-2 text-paper shadow-[0_1px_0_rgb(0_0_0/0.2)]">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-4 px-4">
          <Link to="/tiket" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-6" />
            <span className="font-display text-[17px] font-semibold tracking-tight">SIMRS Harness</span>
          </Link>
          <ConnectionIndicator health={health.data} error={health.error} />
          <div className="ml-auto flex items-center gap-3">
            {health.data ? (
              <span
                className="hidden items-center gap-1.5 rounded border border-white/15 px-2 py-0.5 font-mono text-[11.5px] text-paper/85 md:flex"
                title={health.data.llm.maskPii ? "NIK, telepon dan alamat disamarkan sebelum dikirim ke AI" : "Data tidak disamarkan (model lokal)"}
              >
                <Database className="size-3.5" />
                {health.data.llm.provider} · {health.data.llm.model}
              </span>
            ) : null}
            <UserMenu />
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1600px] gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[13.5px] text-paper/70 hover:text-paper data-[status=active]:bg-paper data-[status=active]:font-medium data-[status=active]:text-ink"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-4 pb-8">
        <section aria-label="Ringkasan" className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={<ClipboardList className="size-5" />} label="Registrasi hari ini" value={s ? s.registrasiHariIni : undefined} hint={s?.khanzaError ?? undefined} />
          <Stat icon={<BedDouble className="size-5" />} label="Pasien rawat inap" value={s ? s.pasienRawatInap : undefined} hint={s?.khanzaError ?? undefined} />
          <Stat icon={<Ticket className="size-5" />} label="Tiket terbuka" value={s?.tiketTerbuka} />
          <Stat icon={<Wrench className="size-5" />} label="Perbaikan menunggu persetujuan" value={s?.perbaikanMenunggu} tone="amber" />
        </section>
        <Outlet />
      </div>
    </div>
  );
};

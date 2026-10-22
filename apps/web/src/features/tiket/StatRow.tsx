/** The four numbers at the top of Tiket: today's registrations, inpatients, open tickets, fixes waiting. */
import type { Stats } from "@simrs/shared";
import { BedDouble, ClipboardList, Ticket, Wrench } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { formatNumber } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";
import { useVersions } from "../../stores/refresh.ts";

const Stat = ({ icon, label, value, tone, hint }: { readonly icon: ReactNode; readonly label: string; readonly value: number | null | undefined; readonly tone?: "amber"; readonly hint?: string | undefined }) => (
  <div className="flex items-center gap-3 rounded-xl border border-line-2 bg-card px-4 py-3" title={hint}>
    <span className={cn("grid size-9 place-items-center rounded-lg", tone === "amber" && value ? "bg-amber-soft text-amber" : "bg-teal-soft text-teal")}>
      {icon}
    </span>
    <div className="min-w-0">
      <p className="font-display text-[22px] leading-none font-semibold tabular-nums">{value === undefined ? "…" : formatNumber(value)}</p>
      <p className="mt-1 truncate text-[12px] text-ink-2">{label}</p>
    </div>
  </div>
);

export const StatRow = () => {
  const stats = useApi<Stats>("/api/stats", { refreshMs: 60_000 });
  const version = useVersions((v) => v.stats);
  const reload = stats.reload;
  useEffect(() => {
    if (version > 0) void reload();
  }, [version, reload]);
  const s = stats.data;
  return (
    <section aria-label="Ringkasan" className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon={<ClipboardList className="size-5" />} label="Registrasi hari ini" value={s ? s.registrasiHariIni : undefined} hint={s?.khanzaError ?? undefined} />
      <Stat icon={<BedDouble className="size-5" />} label="Pasien rawat inap" value={s ? s.pasienRawatInap : undefined} hint={s?.khanzaError ?? undefined} />
      <Stat icon={<Ticket className="size-5" />} label="Tiket terbuka" value={s?.tiketTerbuka} />
      <Stat icon={<Wrench className="size-5" />} label="Perbaikan menunggu persetujuan" value={s?.perbaikanMenunggu} tone="amber" />
    </section>
  );
};

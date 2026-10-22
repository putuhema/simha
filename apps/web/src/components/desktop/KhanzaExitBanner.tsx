/**
 * Desktop app only: shown when Khanza stops right after "Buka di Khanza"
 * started it (Java missing, database setting, window not opening…), with a
 * button to its output in the terminal panel.
 */
import { SquareTerminal, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { desktop, type KhanzaExit } from "../../lib/desktop.ts";

export const KhanzaExitBanner = () => {
  const [exit, setExit] = useState<KhanzaExit | null>(null);
  useEffect(() => desktop?.onKhanzaExit(setExit), []);
  if (!desktop || !exit) return null;
  const bridge = desktop;
  return (
    <div role="alert" className="flex animate-fade-in items-center gap-3 border-b border-amber/20 bg-amber-soft px-4 py-2 text-[13px] text-amber" data-testid="khanza-exit">
      <TriangleAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        Khanza berhenti {exit.seconds} detik setelah dibuka{exit.code !== null ? ` (kode ${exit.code})` : ""}. Lihat outputnya untuk tahu sebabnya.
      </span>
      <button
        type="button"
        onClick={() => {
          void bridge.showKhanzaOutput();
          setExit(null);
        }}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-amber px-2.5 font-medium text-white hover:brightness-110"
      >
        <SquareTerminal className="size-3.5" /> Lihat output
      </button>
      <button type="button" aria-label="Tutup" onClick={() => setExit(null)} className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-amber/10">
        <X className="size-4" />
      </button>
    </div>
  );
};

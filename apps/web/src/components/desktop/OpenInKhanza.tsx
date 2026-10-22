/**
 * "Buka di Khanza" (desktop app only): brings SIMRS Khanza to the front, or
 * starts it, and copies the no. rawat / no. RM so the user can paste it into
 * Khanza's search. The first time, it asks for the file that starts Khanza.
 */
import { AppWindow } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { desktop, type KhanzaResult } from "../../lib/desktop.ts";

const paste = navigator.platform.includes("Mac") ? "⌘V" : "Ctrl+V";

const message = (result: KhanzaResult): { readonly text: string; readonly bad: boolean } => {
  switch (result.status) {
    case "focused":
      return { text: result.copied ? `Khanza dibuka. ${result.copied} disalin — tempel (${paste}) di pencarian.` : "Khanza dibuka.", bad: false };
    case "launched":
      return {
        text: result.copied ? `Membuka Khanza… Setelah login, tempel ${result.copied} (${paste}) di pencarian.` : "Membuka Khanza…",
        bad: false,
      };
    case "not_configured":
      return { text: "Pilih dulu file untuk membuka Khanza.", bad: true };
    case "error":
      return { text: result.message, bad: true };
  }
};

export const OpenInKhanza = ({
  copy,
  label = "Buka di Khanza",
  className,
}: {
  /** No. rawat or no. RM to copy. */
  readonly copy: string | null;
  readonly label?: string;
  readonly className?: string;
}) => {
  const [note, setNote] = useState<{ readonly text: string; readonly bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(timer);
  }, [note]);

  if (!desktop) return null;
  const bridge = desktop;

  const open = async () => {
    setBusy(true);
    try {
      let result = await bridge.openKhanza(copy);
      if (result.status === "not_configured" && (await bridge.chooseKhanzaLauncher())) result = await bridge.openKhanza(copy);
      setNote(message(result));
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        title={copy ? `Buka SIMRS Khanza dan salin ${copy}` : "Buka SIMRS Khanza"}
        data-testid="open-in-khanza"
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-2 bg-card px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-ink-3/50 hover:bg-paper hover:text-ink disabled:opacity-60"
      >
        <AppWindow className="size-3.5" />
        {label}
        {copy ? <span className="font-mono text-[11.5px] font-normal text-ink-3">{copy}</span> : null}
      </button>
      {note ? (
        <span
          role="status"
          className={cn(
            "absolute top-full left-0 z-20 mt-1.5 w-72 animate-fade-in rounded-lg border px-3 py-2 text-[12.5px] shadow-lg",
            note.bad ? "border-red/20 bg-red-soft text-red" : "border-line-2 bg-card text-ink-2",
          )}
        >
          {note.text}
        </span>
      ) : null}
    </span>
  );
};

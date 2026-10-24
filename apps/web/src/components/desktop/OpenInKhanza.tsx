/**
 * "Buka di Khanza" (desktop app only).
 *
 * With a Khanza build that has the bridge, it opens the form itself (resume,
 * CPPT/SOAP or riwayat) for the visit, in the running Khanza; if Khanza is
 * not open it starts it and the form opens after login. Otherwise it brings
 * Khanza to the front and copies the no. rawat / no. RM for its search.
 *
 * The main button does `defaultForm` (or just opens Khanza); the arrow lists
 * the other forms. The first time, it asks for the file that starts Khanza.
 */
import { Menu } from "@base-ui/react/menu";
import { AppWindow, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { desktop, KHANZA_FORMS, type KhanzaForm, type KhanzaResult } from "../../lib/desktop.ts";

const paste = navigator.platform.includes("Mac") ? "⌘V" : "Ctrl+V";

interface Note {
  readonly text: string;
  readonly bad: boolean;
}

const copied = (r: { readonly copied: string | null }) => (r.copied ? ` ${r.copied} disalin — tempel (${paste}) di pencarian.` : "");

const message = (result: KhanzaResult): Note => {
  switch (result.status) {
    case "form_opened":
      return { text: `${result.form} dibuka di Khanza.`, bad: false };
    case "focused":
      if (result.bridge === "missing") {
        return { text: `Khanza dibuka, tapi formnya tidak bisa dibuka langsung: login dulu di Khanza (versi dengan bridge).${copied(result)}`, bad: false };
      }
      if (result.bridge) return { text: `Khanza: ${result.bridge.error}`, bad: true };
      return { text: `Khanza dibuka.${copied(result)}`, bad: false };
    case "launched":
      if (result.pendingForm) return { text: `Membuka Khanza… Setelah login, ${result.pendingForm} terbuka otomatis.`, bad: false };
      return { text: result.copied ? `Membuka Khanza… Setelah login, tempel ${result.copied} (${paste}) di pencarian.` : "Membuka Khanza…", bad: false };
    case "not_configured":
      return { text: "Pilih dulu file untuk membuka Khanza.", bad: true };
    case "error":
      return { text: result.message, bad: true };
  }
};

export const OpenInKhanza = ({
  noRawat = null,
  noRm = null,
  defaultForm,
  label,
  className,
}: {
  readonly noRawat?: string | null;
  readonly noRm?: string | null;
  /** What the main button opens; without it, it just opens Khanza. */
  readonly defaultForm?: KhanzaForm;
  readonly label?: string;
  readonly className?: string;
}) => {
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(timer);
  }, [note]);

  if (!desktop) return null;
  const bridge = desktop;
  const copy = noRawat ?? noRm;
  const forms = KHANZA_FORMS.filter((f) => (f.needsVisit ? noRawat !== null : copy !== null));
  const valueFor = (form: KhanzaForm) => (form === "riwayat" ? (noRawat ?? noRm) : noRawat);
  const main = defaultForm && valueFor(defaultForm) ? KHANZA_FORMS.find((f) => f.form === defaultForm) : undefined;

  const open = async (form: KhanzaForm | null) => {
    setBusy(true);
    const value = form ? valueFor(form) : null;
    const target = form && value ? { form, value } : null;
    try {
      let result = await bridge.openKhanza(copy, target);
      if (result.status === "not_configured" && (await bridge.chooseKhanzaLauncher())) result = await bridge.openKhanza(copy, target);
      setNote(message(result));
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setBusy(false);
    }
  };

  const part = "inline-flex h-7 items-center gap-1.5 border border-line-2 bg-card text-[12.5px] font-medium text-ink-2 transition-colors hover:border-ink-3/50 hover:bg-paper hover:text-ink disabled:opacity-60";
  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => void open(main?.form ?? null)}
        disabled={busy}
        title={main ? `Buka ${main.label} di Khanza` : copy ? `Buka SIMRS Khanza dan salin ${copy}` : "Buka SIMRS Khanza"}
        data-testid="open-in-khanza"
        className={cn(part, "px-2.5", forms.length > 0 ? "rounded-l-md" : "rounded-md")}
      >
        <AppWindow className="size-3.5" />
        {label ?? (main ? `${main.label} di Khanza` : "Buka di Khanza")}
        {copy && !main ? <span className="font-mono text-[11.5px] font-normal text-ink-3">{copy}</span> : null}
      </button>
      {forms.length > 0 ? (
        <Menu.Root>
          <Menu.Trigger aria-label="Pilih form Khanza" disabled={busy} className={cn(part, "-ml-px rounded-r-md px-1.5 data-[popup-open]:bg-paper")}>
            <ChevronDown className="size-3.5" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="end" className="z-50">
              <Menu.Popup className="min-w-56 origin-[var(--transform-origin)] rounded-xl border border-line bg-card p-1.5 text-[13px] shadow-[0_16px_40px_-16px_rgb(23_32_30/0.35)] transition-[opacity,transform] duration-150 ease-out outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:duration-[100ms] data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
                <p className="px-2.5 pt-1 pb-1.5 font-mono text-[11px] text-ink-3">{copy}</p>
                {forms.map((f) => (
                  <Menu.Item
                    key={f.form}
                    onClick={() => void open(f.form)}
                    className="flex cursor-default items-center rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-paper-2"
                  >
                    Buka {f.label}
                  </Menu.Item>
                ))}
                <Menu.Separator className="my-1 h-px bg-line-2" />
                <Menu.Item onClick={() => void open(null)} className="flex cursor-default items-center rounded-md px-2.5 py-1.5 text-ink-2 outline-none data-[highlighted]:bg-paper-2">
                  Buka Khanza saja (salin nomor)
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : null}
      {note ? (
        <span
          role="status"
          className={cn(
            "absolute top-full left-0 z-20 mt-1.5 w-80 animate-fade-in rounded-lg border px-3 py-2 text-[12.5px] shadow-lg",
            note.bad ? "border-red/20 bg-red-soft text-red" : "border-line-2 bg-card text-ink-2",
          )}
        >
          {note.text}
        </span>
      ) : null}
    </span>
  );
};

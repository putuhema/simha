/**
 * The message box: grows with the text, Enter sends (Shift+Enter for a new
 * line), and the round button turns into a stop button with a spinning ring
 * while the AI answers. The "+" menu drops in a sample question, and the
 * read-only chip states what the agent may do with the database.
 */
import { Menu } from "@base-ui/react/menu";
import { ArrowUp, Plus, ShieldAlert, ShieldCheck, Square } from "lucide-react";
import { useLayoutEffect, useRef, type FormEvent } from "react";

const MAX_HEIGHT = 220;

export const Composer = ({
  value,
  onChange,
  onSubmit,
  onStop,
  running,
  placeholder,
  model,
  readOnly,
  examples,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onStop: () => void;
  readonly running: boolean;
  readonly placeholder: string;
  readonly model: string | null;
  readonly readOnly?: boolean | undefined;
  readonly examples?: ReadonlyArray<string> | undefined;
}) => {
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!running && value.trim()) onSubmit();
  };

  const pick = (example: string) => {
    onChange(example);
    box.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      onClick={() => box.current?.focus()}
      className="rounded-[22px] border border-line bg-card transition-colors focus-within:border-ink-3/45"
    >
      <textarea
        ref={box}
        rows={1}
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
        }}
        placeholder={placeholder}
        aria-label="Pertanyaan"
        className="quiet-scroll block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14.5px] leading-relaxed outline-none placeholder:text-ink-3"
      />
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
        {examples && examples.length > 0 ? (
          <Menu.Root>
            <Menu.Trigger
              aria-label="Sisipkan contoh"
              title="Contoh pertanyaan"
              className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink data-[popup-open]:bg-paper-2"
            >
              <Plus className="size-4" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50">
                <Menu.Popup className="min-w-64 origin-[var(--transform-origin)] rounded-xl border border-line bg-card p-1.5 text-[13px] shadow-[0_18px_44px_-20px_rgb(26_31_30/0.35)] transition-[opacity,transform] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
                  <p className="px-2.5 pt-1 pb-1.5 font-display text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">Contoh pertanyaan</p>
                  {examples.map((example) => (
                    <Menu.Item
                      key={example}
                      onClick={() => pick(example)}
                      className="flex cursor-default items-center rounded-lg px-2.5 py-1.5 text-ink-2 outline-none data-[highlighted]:bg-paper-2 data-[highlighted]:text-ink"
                    >
                      {example}
                    </Menu.Item>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : null}

        {readOnly === undefined ? null : (
          <span
            className="hidden h-7 min-w-0 items-center gap-1.5 rounded-md border border-line-2 bg-paper/50 px-2 text-[11px] text-ink-2 sm:inline-flex"
            title={readOnly ? "AI hanya bisa membaca data: query SELECT, maks 500 baris." : "User database bisa menulis — segera perbaiki hak aksesnya."}
          >
            {readOnly ? <ShieldCheck className="size-3.5 shrink-0 text-teal" /> : <ShieldAlert className="size-3.5 shrink-0 text-red" />}
            <span className="truncate">{readOnly ? "Read-only" : "Bisa menulis"}</span>
          </span>
        )}

        <span className="ml-auto flex min-w-0 items-center gap-2">
          {model ? (
            <span className="hidden min-w-0 items-center gap-1.5 text-[10.5px] text-ink-3 sm:flex" title={model}>
              <span className="size-1.5 shrink-0 rounded-full bg-teal/70" />
              <span className="max-w-[170px] truncate font-mono">{model}</span>
            </span>
          ) : null}
          {running ? (
            <button
              type="button"
              aria-label="Hentikan"
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
              className="relative grid size-8 shrink-0 place-items-center rounded-full bg-teal-2 text-paper transition-transform active:scale-95"
            >
              <span className="absolute inset-0.5 animate-spin rounded-full border-2 border-paper/25 border-t-paper" />
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Kirim"
              disabled={!value.trim()}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-teal-2 text-paper transition-[background-color,transform] hover:bg-teal active:scale-95 disabled:bg-paper-2 disabled:text-ink-3"
            >
              <ArrowUp className="size-4" strokeWidth={2.4} />
            </button>
          )}
        </span>
      </div>
    </form>
  );
};

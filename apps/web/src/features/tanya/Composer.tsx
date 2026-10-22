/**
 * The message box at the bottom of the chat: grows with the text, Enter
 * sends (Shift+Enter for a new line), and the round button turns into a
 * stop button with a spinning ring while the AI answers.
 */
import { ArrowUp, Square } from "lucide-react";
import { useLayoutEffect, useRef, type FormEvent } from "react";
import { cn } from "../../lib/cn.ts";

const MAX_HEIGHT = 220;

export const Composer = ({
  value,
  onChange,
  onSubmit,
  onStop,
  running,
  placeholder,
  model,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onStop: () => void;
  readonly running: boolean;
  readonly placeholder: string;
  readonly model: string | null;
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

  return (
    <form
      onSubmit={submit}
      onClick={() => box.current?.focus()}
      className="rounded-[26px] border border-line bg-card shadow-[0_8px_30px_-12px_rgb(23_32_30/0.18)] transition-[border-color,box-shadow] focus-within:border-ink-3/60 focus-within:shadow-[0_10px_34px_-12px_rgb(23_32_30/0.26)]"
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
        className="quiet-scroll block w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-ink-3"
      />
      <div className="flex items-center gap-2 px-3 pb-3 pl-5">
        {model ? <span className="ml-auto hidden truncate font-mono text-[11.5px] text-ink-3 sm:block">{model}</span> : null}
        {running ? (
          <button
            type="button"
            aria-label="Hentikan"
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
            className={cn("relative grid size-9 shrink-0 place-items-center rounded-full bg-teal-2 text-paper transition-transform active:scale-95", !model && "ml-auto")}
          >
            <span className="absolute inset-0.5 animate-spin rounded-full border-2 border-paper/25 border-t-paper" />
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Kirim"
            disabled={!value.trim()}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full bg-teal-2 text-paper transition-[background-color,transform] hover:bg-teal active:scale-95 disabled:bg-line disabled:text-card",
              !model && "ml-auto",
            )}
          >
            <ArrowUp className="size-[18px]" strokeWidth={2.4} />
          </button>
        )}
      </div>
    </form>
  );
};

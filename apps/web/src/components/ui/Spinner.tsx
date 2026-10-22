import { cn } from "../../lib/cn.ts";

export const Spinner = ({ className }: { readonly className?: string }) => (
  <span
    role="status"
    aria-label="Memuat"
    className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
  />
);

export const Empty = ({ title, children }: { readonly title: string; readonly children?: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
    <p className="font-display text-[15px] font-semibold text-ink-2">{title}</p>
    {children ? <div className="max-w-sm text-[13px] text-ink-3">{children}</div> : null}
  </div>
);

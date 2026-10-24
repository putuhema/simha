import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

/** A modal dialog (Base UI) with a title, optional description and a close button. */
export const Dialog = ({
  open,
  onOpenChange,
  title,
  description,
  wide,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly wide?: boolean | undefined;
  readonly children: ReactNode;
}) => (
  <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 bg-ink/35 backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms] data-[starting-style]:opacity-0" />
      <BaseDialog.Viewport className="fixed inset-0 grid place-items-center overflow-y-auto p-4">
        <BaseDialog.Popup
          className={cn(
            "w-full rounded-xl border border-line bg-card p-5 shadow-[0_24px_60px_-20px_rgb(23_32_30/0.45)] transition-[opacity,transform] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms] data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <BaseDialog.Title className="font-display text-[19px] font-semibold">{title}</BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="mt-0.5 text-[13px] text-ink-2">{description}</BaseDialog.Description>
              ) : null}
            </div>
            <BaseDialog.Close className="rounded-md p-1 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Tutup">
              <X className="size-4" />
            </BaseDialog.Close>
          </div>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  </BaseDialog.Root>
);

/** A small dark tooltip with an optional keyboard shortcut, for icon buttons. */
import { Tooltip } from "@base-ui/react/tooltip";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const TipProvider = ({ children }: { readonly children: ReactNode }) => (
  <Tooltip.Provider delay={400} closeDelay={0}>
    {children}
  </Tooltip.Provider>
);

/** A button with a tooltip. `label` is also its accessible name. */
export const TipButton = ({
  label,
  shortcut,
  side = "bottom",
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  readonly label: string;
  readonly shortcut?: string;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly children: ReactNode;
}) => (
  <Tooltip.Root>
    <Tooltip.Trigger type="button" aria-label={label} {...props}>
      {children}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Positioner side={side} sideOffset={6} className="z-50">
        <Tooltip.Popup className="flex origin-[var(--transform-origin)] items-center gap-2 rounded-md bg-teal-2 px-2 py-1 text-[12px] text-paper shadow-lg transition-[opacity,transform] duration-[125ms] ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:duration-[80ms] data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          {label}
          {shortcut ? <kbd className="rounded bg-white/15 px-1 font-sans text-[11px] text-paper/85">{shortcut}</kbd> : null}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);

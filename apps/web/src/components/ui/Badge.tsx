import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const badge = cva(
  "inline-flex items-center gap-1 rounded px-1.5 py-px font-display text-[11px] font-semibold tracking-wide uppercase",
  {
    variants: {
      tone: {
        neutral: "bg-paper-2 text-ink-2",
        teal: "bg-teal-soft text-teal",
        amber: "bg-amber-soft text-amber",
        red: "bg-red-soft text-red",
        ok: "bg-ok-soft text-ok",
        ink: "bg-ink text-paper",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export const Badge = ({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ tone }), className)} {...props} />
);

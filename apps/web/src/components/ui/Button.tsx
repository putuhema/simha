import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-teal text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)] hover:bg-teal-2",
        approve: "bg-ok text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.2)] hover:brightness-110",
        danger: "bg-red text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.2)] hover:brightness-110",
        outline: "border border-line bg-card text-ink hover:border-ink-3 hover:bg-paper",
        ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink",
        quiet: "text-teal underline-offset-2 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px]",
        md: "h-9 px-3.5 text-[13.5px]",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;

export const Button = ({ className, variant, size, type = "button", ...props }: ButtonProps) => (
  <button type={type} className={cn(button({ variant, size }), className)} {...props} />
);

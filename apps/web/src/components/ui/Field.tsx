import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const control =
  "w-full rounded-md border border-line bg-card px-3 text-[14px] text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] outline-none focus:border-teal focus:shadow-[0_0_0_3px_var(--color-teal-soft)] disabled:opacity-60";

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(control, "h-9", className)} {...props} />
);

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn(control, "py-2 leading-relaxed", className)} {...props} />
);

export const Field = ({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) => (
  <label className="flex flex-col gap-1">
    <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
    {children}
    {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
  </label>
);

export const ErrorText = ({ children }: { readonly children: ReactNode }) =>
  children ? (
    <p role="alert" className="rounded-md border border-red/25 bg-red-soft px-3 py-2 text-[13px] text-red">
      {children}
    </p>
  ) : null;

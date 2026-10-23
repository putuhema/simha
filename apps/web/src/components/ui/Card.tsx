import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg border border-line bg-card shadow-[0_1px_0_rgb(23_32_30/0.04)]", className)} {...props} />
);

/** Card with a small-caps label and optional actions on the right. */
export const Panel = ({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: {
  readonly title: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly children: ReactNode;
}) => (
  <Card className={cn("flex min-h-0 flex-col", className)}>
    <div className="flex items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5">
      <h2 className="eyebrow">{title}</h2>
      {actions}
    </div>
    <div className={cn("min-h-0 flex-1 p-4", bodyClassName)}>{children}</div>
  </Card>
);

import { Collapsible } from "@base-ui/react/collapsible";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";

/** SQL on a perforated slip, with a copy button. */
export const SqlSlip = ({ sql, className }: { readonly sql: string; readonly className?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("slip group", className)}>
      <pre className="overflow-x-auto py-2.5 pr-10 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink">{sql}</pre>
      <button
        type="button"
        aria-label="Salin SQL"
        onClick={() => {
          void navigator.clipboard?.writeText(sql).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute top-2 right-2 rounded p-1 text-ink-3 opacity-60 hover:bg-paper-2 hover:text-ink group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
};

/** "Query yang dipakai", closed by default. */
export const SqlDisclosure = ({ sql, label = "Query yang dipakai" }: { readonly sql: string; readonly label?: string }) => (
  <Collapsible.Root>
    <Collapsible.Trigger className="group flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
      <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
      {label}
    </Collapsible.Trigger>
    <Collapsible.Panel className="mt-2">
      <SqlSlip sql={sql} />
    </Collapsible.Panel>
  </Collapsible.Root>
);

/**
 * Audit log: questions (runs), tool calls, queries to Khanza, fix approvals
 * and logins, filterable by text and date.
 */
import type { AuditKind, AuditPage } from "@simha/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { DataTable } from "../../components/blocks/DataTable.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { ErrorText, Input } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { cn } from "../../lib/cn.ts";
import { useApi } from "../../lib/useApi.ts";

const KINDS: ReadonlyArray<readonly [AuditKind, string]> = [
  ["runs", "Pertanyaan"],
  ["tools", "Tool"],
  ["queries", "Query"],
  ["fixes", "Perbaikan"],
  ["events", "Login & pengaturan"],
];
const PAGE = 50;

export const AuditLog = () => {
  const [kind, setKind] = useState<AuditKind>("runs");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => setOffset(0), [kind, query, from, to]);

  const params = new URLSearchParams({ kind, limit: String(PAGE), offset: String(offset) });
  if (query) params.set("q", query);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const page = useApi<AuditPage>(`/api/audit?${params.toString()}`);
  const columns = Object.keys(page.data?.rows[0] ?? {});

  return (
    <Panel title="Audit log">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-md bg-paper-2 p-0.5" role="tablist" aria-label="Jenis audit">
          {KINDS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={kind === value}
              onClick={() => setKind(value)}
              className={cn("rounded px-2.5 py-1 text-[12.5px]", kind === value ? "bg-card font-medium shadow-sm" : "text-ink-2 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari…" className="h-8 w-48" aria-label="Cari di audit log" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" aria-label="Dari tanggal" />
        <span className="text-ink-3">–</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" aria-label="Sampai tanggal" />
        {page.loading ? <Spinner className="text-ink-3" /> : null}
      </div>
      <ErrorText>{page.error}</ErrorText>
      {page.data ? <DataTable columns={columns} rows={page.data.rows} maxHeight={520} /> : null}
      {page.data ? (
        <div className="mt-2 flex items-center justify-between text-[12.5px] text-ink-3">
          <span>
            {page.data.total === 0 ? "Tidak ada catatan" : `${offset + 1}–${Math.min(offset + PAGE, page.data.total)} dari ${page.data.total}`}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              <ChevronLeft /> Sebelumnya
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + PAGE >= page.data.total} onClick={() => setOffset(offset + PAGE)}>
              Berikutnya <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
};

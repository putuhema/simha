import type { Ticket } from "@simha/shared";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { ErrorText, Field, Input, Textarea } from "../../components/ui/Field.tsx";
import { Empty, Spinner } from "../../components/ui/Spinner.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { formatRelative } from "../../lib/format.ts";

export const TICKET_STATUS: Readonly<Record<Ticket["status"], { readonly label: string; readonly tone: "amber" | "teal" | "ok" | "neutral" }>> = {
  open: { label: "Baru", tone: "amber" },
  investigating: { label: "Diselidiki", tone: "teal" },
  diagnosed: { label: "Didiagnosis", tone: "ok" },
  closed: { label: "Selesai", tone: "neutral" },
};

export const TicketList = ({
  tickets,
  selectedId,
  onSelect,
  onCreated,
}: {
  readonly tickets: ReadonlyArray<Ticket> | undefined;
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onCreated: (ticket: Ticket) => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line-2 px-3 py-2.5">
        <h2 className="eyebrow">Tiket</h2>
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
          <Plus /> Tiket baru
        </Button>
      </div>
      <ul className="stagger min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-15rem)]" aria-label="Daftar tiket">
        {tickets === undefined ? (
          <li className="p-4">
            <Spinner className="text-ink-3" />
          </li>
        ) : tickets.length === 0 ? (
          <li>
            <Empty title="Belum ada tiket">Klik “Tiket baru” lalu tempel keluhan perawat.</Empty>
          </li>
        ) : (
          tickets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                aria-current={t.id === selectedId ? "true" : undefined}
                className={cn(
                  "w-full border-b border-line-2 px-3 py-2.5 text-left transition-colors hover:bg-paper",
                  t.id === selectedId && "bg-teal-soft/50 shadow-[inset_3px_0_0_var(--color-teal)]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">
                    {t.nurseName} <span className="font-normal text-ink-3">· {t.unit}</span>
                  </span>
                  <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{t.complaint}</p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-3">{formatRelative(t.createdAt)}</p>
              </button>
            </li>
          ))
        )}
      </ul>
      <NewTicketDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(ticket) => {
          setOpen(false);
          onCreated(ticket);
        }}
      />
    </div>
  );
};

const NewTicketDialog = ({
  open,
  onOpenChange,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (ticket: Ticket) => void;
}) => {
  const [form, setForm] = useState({ nurseName: "", unit: "", complaint: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ticket = await api.post<Ticket>("/api/tickets", {
        nurseName: form.nurseName.trim(),
        unit: form.unit.trim(),
        complaint: form.complaint.trim(),
      });
      setForm({ nurseName: "", unit: "", complaint: "" });
      onCreated(ticket);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Tiket baru" description="Tempel keluhan perawat. AI langsung memeriksa data setelah tiket dibuat.">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nama perawat">
            <Input value={form.nurseName} onChange={(e) => setForm({ ...form, nurseName: e.target.value })} required maxLength={100} />
          </Field>
          <Field label="Unit / bangsal">
            <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required maxLength={100} />
          </Field>
        </div>
        <Field label="Keluhan">
          <Textarea
            rows={5}
            value={form.complaint}
            onChange={(e) => setForm({ ...form, complaint: e.target.value })}
            placeholder="Contoh: Pasien RM 012345 tidak bisa dipindah ke kamar Mawar"
            required
            maxLength={5000}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : null} Buat & selidiki
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

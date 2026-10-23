/**
 * A proposed fix: the exact SQL, how many rows it changes, the rows as they
 * are now, and Approve / Edit / Reject. After approval: the result and
 * Rollback. Every action asks for confirmation and shows who did what.
 */
import { Collapsible } from "@base-ui/react/collapsible";
import type { Fix, FixDetail } from "@simha/shared";
import { Check, ChevronRight, Pencil, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { DataTable } from "../blocks/DataTable.tsx";
import { SqlSlip } from "../blocks/SqlSlip.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { ErrorText, Field, Input, Textarea } from "../ui/Field.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";

const STATUS: Readonly<Record<Fix["status"], { readonly label: string; readonly tone: "amber" | "teal" | "ok" | "red" | "neutral" }>> = {
  pending: { label: "Menunggu persetujuan", tone: "amber" },
  approved: { label: "Disetujui, berjalan", tone: "teal" },
  applied: { label: "Sudah dijalankan", tone: "ok" },
  failed: { label: "Gagal, dibatalkan", tone: "red" },
  rejected: { label: "Ditolak", tone: "neutral" },
  rolled_back: { label: "Sudah di-rollback", tone: "neutral" },
};

const ACTION_LABEL: Readonly<Record<string, string>> = {
  proposed: "mengusulkan",
  approved: "menyetujui",
  rejected: "menolak",
  applied: "dijalankan",
  apply_failed: "gagal dijalankan",
  rollback_requested: "meminta rollback",
  rolled_back: "rollback selesai",
  rollback_failed: "rollback gagal",
};

const columnsOf = (rows: ReadonlyArray<Readonly<Record<string, unknown>>>) => Object.keys(rows[0] ?? {});

const Rows = ({ label, rows }: { readonly label: string; readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>> }) => (
  <Collapsible.Root>
    <Collapsible.Trigger className="group flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
      <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
      {label} ({rows.length} baris)
    </Collapsible.Trigger>
    <Collapsible.Panel className="mt-2">
      <DataTable columns={columnsOf(rows)} rows={rows} maxHeight={260} />
    </Collapsible.Panel>
  </Collapsible.Root>
);

type Pending = "approve" | "reject" | "rollback" | "edit" | null;

export const FixCard = ({ fixId, onChanged }: { readonly fixId: string; readonly onChanged: () => void }) => {
  const detail = useApi<FixDetail>(`/api/fixes/${fixId}`);
  const [dialog, setDialog] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const fix = detail.data?.fix;
  if (!fix) {
    return detail.error ? <ErrorText>{detail.error}</ErrorText> : <Spinner className="text-ink-3" />;
  }
  const status = STATUS[fix.status];

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/fixes/${fix.id}/${path}`, body);
      setDialog(null);
      await detail.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      await detail.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="animate-rise rounded-lg border border-line bg-card" data-testid="fix-card" data-status={fix.status}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line-2 px-4 py-3">
        <div className="min-w-0">
          <h4 className="font-display text-[15px] leading-tight font-semibold">{fix.title}</h4>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            {fix.kind.toUpperCase()} <span className="font-mono">{fix.table}</span> · akan mengubah{" "}
            <strong className="text-ink">{fix.expectedRows} baris</strong>
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <div className="space-y-3 px-4 py-3">
        <p className="text-[13.5px] text-ink-2">{fix.reason}</p>
        <SqlSlip sql={fix.sql} />
        {fix.preview.length > 0 ? <Rows label="Baris yang akan berubah" rows={fix.preview} /> : null}
        {fix.before ? <Rows label="Data sebelum" rows={fix.before} /> : null}
        {fix.after && fix.after.length > 0 ? <Rows label="Data sesudah" rows={fix.after} /> : null}
        {fix.error ? <ErrorText>{fix.error}</ErrorText> : null}
        {error && dialog === null ? <ErrorText>{error}</ErrorText> : null}

        {fix.status === "pending" ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="approve" onClick={() => setDialog("approve")}>
              <Check /> Setujui
            </Button>
            <Button onClick={() => setDialog("edit")}>
              <Pencil /> Edit
            </Button>
            <Button variant="ghost" className="text-red hover:bg-red-soft hover:text-red" onClick={() => setDialog("reject")}>
              <X /> Tolak
            </Button>
          </div>
        ) : null}
        {fix.status === "applied" ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <p className="text-[13px] text-ok">Perubahan sudah dijalankan dan bisa dibatalkan.</p>
            <Button variant="danger" size="sm" onClick={() => setDialog("rollback")}>
              <RotateCcw /> Rollback
            </Button>
          </div>
        ) : null}
      </div>

      {detail.data && detail.data.events.length > 0 ? (
        <footer className="border-t border-line-2 bg-paper/40 px-4 py-2">
          <ol className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-ink-3">
            {detail.data.events.map((e) => (
              <li key={e.id} title={e.detail ?? undefined}>
                <span className="font-medium text-ink-2">{e.actor}</span> {ACTION_LABEL[e.action] ?? e.action} ·{" "}
                {formatDateTime(e.at)}
              </li>
            ))}
          </ol>
        </footer>
      ) : null}

      <Dialog
        open={dialog === "approve" || dialog === "rollback"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === "rollback" ? "Rollback perbaikan ini?" : "Jalankan perbaikan ini?"}
        description={
          dialog === "rollback"
            ? `Data ${fix.expectedRows} baris di ${fix.table} dikembalikan seperti sebelum perbaikan. Ditolak jika data sudah berubah lagi.`
            : `Server menjalankan SQL ini di database Khanza dalam satu transaksi, dan membatalkannya jika jumlah baris yang berubah bukan ${fix.expectedRows}.`
        }
      >
        <SqlSlip sql={fix.sql} className="mb-4" />
        <ErrorText>{error}</ErrorText>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Batal
          </Button>
          {dialog === "rollback" ? (
            <Button variant="danger" disabled={busy} onClick={() => void act("rollback")}>
              {busy ? <Spinner /> : <RotateCcw />} Ya, rollback
            </Button>
          ) : (
            <Button variant="approve" disabled={busy} onClick={() => void act("approve")} data-testid="confirm-approve">
              {busy ? <Spinner /> : <Check />} Ya, jalankan ({fix.expectedRows} baris)
            </Button>
          )}
        </div>
      </Dialog>

      <Dialog open={dialog === "reject"} onOpenChange={(open) => !open && setDialog(null)} title="Tolak perbaikan">
        <Field label="Alasan (opsional)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Batal
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void act("reject", reason.trim() ? { reason: reason.trim() } : {})}>
            Tolak
          </Button>
        </div>
      </Dialog>

      {dialog === "edit" ? <EditFixDialog fix={fix} onClose={() => setDialog(null)} onSaved={onChanged} /> : null}
    </article>
  );
};

/** Edit = propose a corrected fix; the server rejects the original. */
const EditFixDialog = ({ fix, onClose, onSaved }: { readonly fix: Fix; readonly onClose: () => void; readonly onSaved: () => void }) => {
  const [title, setTitle] = useState(fix.title);
  const [reason, setReason] = useState(fix.reason);
  const [sql, setSql] = useState(fix.sqlOriginal);
  const [params, setParams] = useState(JSON.stringify(fix.params));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(params || "[]");
      if (!Array.isArray(parsed)) throw new Error();
    } catch {
      return setError('Params harus berupa array JSON, misalnya ["Pindah Kamar", "2026/10/21/000002"].');
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/fixes", { title, reason, sql, params: parsed, replaces: fix.id });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} wide title="Edit perbaikan" description="Usulan baru diperiksa ulang (tabel, WHERE, jumlah baris) dan usulan lama ditolak.">
      <div className="flex flex-col gap-3">
        <Field label="Judul">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Alasan">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
        <Field label="SQL (pakai ? untuk nilai)">
          <Textarea rows={5} className="font-mono text-[12.5px]" value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Params (array JSON)">
          <Input className="font-mono text-[12.5px]" value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? <Spinner /> : null} Simpan usulan baru
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

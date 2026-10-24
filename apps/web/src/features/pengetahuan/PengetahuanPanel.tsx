/**
 * What the AI learned: automatic examples from successful answers, notes it
 * wrote itself, staff notes and 👎 corrections. Admins can verify, disable,
 * edit or delete items; everyone can add a note.
 */
import type { Knowledge } from "@simha/shared";
import { BookOpen, Check, Eye, EyeOff, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { SqlDisclosure } from "../../components/blocks/SqlSlip.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { ErrorText, Field, Input, Textarea } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";
import { useAuth } from "../../stores/auth.ts";

const KIND_LABEL: Readonly<Record<Knowledge["kind"], string>> = { example: "Contoh", note: "Catatan" };
const SOURCE_LABEL: Readonly<Record<Knowledge["source"], string>> = {
  auto: "otomatis",
  feedback: "umpan balik",
  ai: "AI",
  staff: "staf",
};

const matches = (item: Knowledge, query: string) => {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return `${item.text} ${item.title ?? ""} ${item.sql ?? ""} ${SOURCE_LABEL[item.source]}`.toLowerCase().includes(q);
};

/** Admin: correct a note or an example's question. */
const EditKnowledgeDialog = ({
  item,
  onClose,
  onSaved,
}: {
  readonly item: Knowledge;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) => {
  const [text, setText] = useState(item.text);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/knowledge/${item.id}`, { text: text.trim() });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())} title="Edit pengetahuan" description={KIND_LABEL[item.kind]}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        <Field label={item.kind === "example" ? "Pertanyaan" : "Catatan"}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1_000} required />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={saving || text.trim() === ""}>
            Simpan
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export const PengetahuanPanel = () => {
  const me = useAuth((s) => s.user);
  const isAdmin = me?.role === "admin";
  const list = useApi<ReadonlyArray<Knowledge>>("/api/knowledge");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | Knowledge["kind"]>("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Knowledge | null>(null);

  const items = (list.data ?? []).filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      (!reviewOnly || (!item.verified && item.active)) &&
      matches(item, query),
  );
  const needsReview = (list.data ?? []).filter((item) => !item.verified && item.active).length;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "") return;
    setAdding(true);
    setError(null);
    try {
      await api.post("/api/knowledge", { text });
      setDraft("");
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  };

  const patch = async (item: Knowledge, change: { verified?: boolean; active?: boolean }) => {
    setError(null);
    try {
      await api.patch(`/api/knowledge/${item.id}`, change);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (item: Knowledge) => {
    if (!window.confirm("Hapus pengetahuan ini? AI tidak akan memakainya lagi.")) return;
    setError(null);
    try {
      await api.delete(`/api/knowledge/${item.id}`);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div>
      <p className="mb-5 max-w-3xl text-[13.5px] text-ink-2">
        Contoh pertanyaan + SQL dan catatan yang dipakai AI untuk pertanyaan berikutnya. Contoh otomatis disimpan
        setelah hasil tampil; 👍 menaikkannya menjadi terverifikasi, 👎 mematikan contoh itu dan menyimpan koreksi
        sebagai catatan. Semua ini hanya konteks untuk AI — tidak pernah mengubah data Khanza.
      </p>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Panel
              title={`Daftar (${items.length})`}
              actions={list.loading ? <Spinner className="text-ink-3" /> : null}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex gap-1 rounded-md bg-paper-2 p-0.5" role="tablist" aria-label="Jenis pengetahuan">
                  {(["all", "example", "note"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={kind === value}
                      onClick={() => setKind(value)}
                      className={cn(
                        "rounded px-2.5 py-1 text-[12.5px]",
                        kind === value ? "bg-card font-medium shadow-sm" : "text-ink-2 hover:text-ink",
                      )}
                    >
                      {value === "all" ? "Semua" : KIND_LABEL[value]}
                    </button>
                  ))}
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setReviewOnly(!reviewOnly)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-[12.5px]",
                      reviewOnly ? "border-amber/40 bg-amber-soft text-amber" : "border-line text-ink-2 hover:text-ink",
                    )}
                  >
                    Perlu ditinjau{needsReview > 0 ? ` (${needsReview})` : ""}
                  </button>
                ) : null}
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cari…"
                    aria-label="Cari pengetahuan"
                    className="h-8 w-52 pl-7"
                  />
                </div>
              </div>
              <ErrorText>{error ?? list.error}</ErrorText>
              {items.length === 0 && !list.loading ? (
                <p className="py-8 text-center text-[13px] text-ink-3">
                  {query || kind !== "all" || reviewOnly
                    ? "Tidak ada yang cocok."
                    : "Belum ada. AI menyimpan contoh setelah hasil query tampil; Anda juga bisa menambah catatan."}
                </p>
              ) : (
                <ul className="divide-y divide-line-2">
                  {items.map((item) => (
                    <li key={item.id} className="py-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <Badge tone={item.kind === "example" ? "teal" : "neutral"}>{KIND_LABEL[item.kind]}</Badge>
                        <Badge tone="neutral">{SOURCE_LABEL[item.source]}</Badge>
                        {item.verified ? (
                          <Badge tone="ok">
                            <Check className="size-3" /> Terverifikasi
                          </Badge>
                        ) : (
                          <Badge tone="amber">Belum dicek</Badge>
                        )}
                        {!item.active ? <Badge tone="red">Nonaktif</Badge> : null}
                        <span className="ml-auto font-mono text-[11.5px] text-ink-3">
                          {item.uses}× dipakai · {formatDateTime(item.createdAt)}
                          {item.createdBy ? ` · ${item.createdBy}` : ""}
                        </span>
                      </div>
                      {item.title ? <p className="mt-1.5 text-[13px] font-medium text-ink-2">{item.title}</p> : null}
                      <p className="mt-1 text-[13.5px] whitespace-pre-wrap text-ink">{item.text}</p>
                      {item.sql ? (
                        <div className="mt-2">
                          <SqlDisclosure sql={item.sql} label="SQL contoh" />
                        </div>
                      ) : null}
                      {isAdmin ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" onClick={() => void patch(item, { verified: !item.verified })}>
                            <Check /> {item.verified ? "Batalkan verifikasi" : "Verifikasi"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void patch(item, { active: !item.active })}>
                            {item.active ? <EyeOff /> : <Eye />} {item.active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                            <Pencil /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={() => void remove(item)}>
                            <Trash2 /> Hapus
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <aside className="space-y-4">
            <Panel title="Tambah catatan">
              <form onSubmit={(e) => void add(e)} className="flex flex-col gap-2">
                <Field
                  label="Aturan atau fakta umum"
                  hint="Tanpa nomor pasien / no. rawat. Aktif langsung untuk pertanyaan berikutnya, ditandai belum dicek."
                >
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    maxLength={1_000}
                    required
                    placeholder="mis. Pasien BPJS memakai penjab kd_pj = BPJ; umum = A09."
                  />
                </Field>
                <Button type="submit" variant="primary" disabled={adding || draft.trim() === ""}>
                  <Plus /> Simpan catatan
                </Button>
              </form>
            </Panel>
            <Panel title="Cara kerja">
              <ul className="space-y-2 text-[13px] text-ink-2">
                <li className="flex gap-2">
                  <BookOpen className="mt-0.5 size-4 shrink-0 text-teal" />
                  Sebelum setiap pertanyaan, server mencari contoh dan catatan yang paling mirip lalu menambahkannya ke
                  pesan untuk AI — bukan ke data Khanza.
                </li>
                <li>
                  <strong>Contoh</strong> berisi pertanyaan + SQL. Yang otomatis belum dicek; 👍 membuatnya terverifikasi
                  dan lebih diutamakan.
                </li>
                <li>
                  <strong>Catatan</strong> berisi fakta skema, kode lokal, atau koreksi staf. Catatan AI aktif langsung
                  tetapi bisa dinonaktifkan admin.
                </li>
              </ul>
            </Panel>
          </aside>
        </div>
      {editing ? <EditKnowledgeDialog item={editing} onClose={() => setEditing(null)} onSaved={() => void list.reload()} /> : null}
    </div>
  );
};

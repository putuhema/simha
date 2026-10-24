/**
 * A draft of a Khanza form (resume medis rawat inap): every field of Khanza's
 * form, grouped like it, showing where each value came from (Khanza data,
 * the existing resume, the AI from the chat, or the user). Edits are saved to
 * the draft on blur. "Isi di Khanza" (desktop app) opens Khanza's own form
 * filled with the draft; the user saves it there.
 */
import { Collapsible } from "@base-ui/react/collapsible";
import { FORM_FIELDS, FORM_TITLES, fieldProblem, type FieldSource, type FormDraft, type FormField } from "@simha/shared";
import { AppWindow, ChevronRight, FilePenLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { desktop, type KhanzaFillResult } from "../../lib/desktop.ts";
import { formatDateTime } from "../../lib/format.ts";
import { Badge } from "../ui/Badge.tsx";

const SOURCE: Readonly<Record<FieldSource, { readonly label: string; readonly className: string }>> = {
  data: { label: "dari data Khanza", className: "bg-teal-soft text-teal" },
  khanza: { label: "resume di Khanza", className: "bg-paper-2 text-ink-2" },
  ai: { label: "dari jawaban di chat", className: "bg-amber-soft text-amber" },
  user: { label: "diubah", className: "bg-ink/8 text-ink-2" },
};

/** Groups that start open: where the user usually has work to do. */
const OPEN_GROUPS = new Set(["Anamnesis & pemeriksaan", "Pulang"]);

const fillMessage = (result: KhanzaFillResult): { readonly text: string; readonly bad: boolean } => {
  switch (result.status) {
    case "filled":
      return result.mode === "ganti"
        ? { text: "Form Resume Ranap terbuka di Khanza dan sudah diisi. Periksa, lalu klik Ganti (resume ini sudah pernah disimpan).", bad: false }
        : { text: "Form Resume Ranap terbuka di Khanza dan sudah diisi. Periksa, lalu klik Simpan di Khanza.", bad: false };
    case "waiting_login":
      return { text: "Membuka Khanza… Setelah login, form Resume Ranap terbuka dan terisi otomatis.", bad: false };
    case "bridge_missing":
      return { text: "Khanza terbuka tapi belum bisa diisi: login dulu di Khanza (versi dengan bridge), lalu klik lagi.", bad: true };
    case "not_configured":
      return { text: "Pilih dulu file untuk membuka Khanza (Pengaturan → Desktop).", bad: true };
    case "error":
      return { text: result.message, bad: true };
  }
};

const toLocalInput = (value: string) => value.replace(" ", "T").slice(0, 16);
const fromLocalInput = (value: string) => value.replace("T", " ");

const Field = ({
  field,
  value,
  source,
  onChange,
  onCommit,
}: {
  readonly field: FormField;
  readonly value: string;
  readonly source: FieldSource | undefined;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
}) => {
  const problem = fieldProblem(field, value);
  const missing = field.required && value.trim() === "";
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  }, [value]);
  const control = cn(
    "w-full rounded-lg border bg-card px-2.5 py-1.5 text-[13.5px] text-ink outline-none transition-colors focus:border-teal",
    problem || missing ? "border-red/50" : "border-line-2",
  );
  return (
    <label className={cn("block", field.type === "textarea" && "@[520px]:col-span-2")} data-field={field.key}>
      <span className="mb-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
        <span className="font-medium">{field.label}</span>
        {missing ? <span className="rounded bg-red-soft px-1.5 text-[10.5px] font-medium text-red">wajib</span> : null}
        {source && value ? <span className={cn("rounded px-1.5 text-[10.5px]", SOURCE[source].className)}>{SOURCE[source].label}</span> : null}
        {field.max ? (
          <span className={cn("ml-auto font-mono text-[10.5px]", value.length > field.max ? "text-red" : "text-ink-3")}>
            {value.length}/{field.max}
          </span>
        ) : null}
      </span>
      {field.type === "textarea" ? (
        <textarea ref={area} rows={2} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} className={cn(control, "resize-none leading-snug")} />
      ) : field.type === "choice" ? (
        <select
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onCommit();
          }}
          className={control}
        >
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "datetime" ? (
        <input type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} onBlur={onCommit} className={control} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} className={control} />
      )}
      {problem ? <span className="mt-0.5 block text-[11.5px] text-red">{problem}</span> : null}
    </label>
  );
};

export const DraftCard = ({
  draft: initial,
  fill = false,
  flat = false,
}: {
  readonly draft: FormDraft;
  /** Fill the card panel: fields scroll, the action footer stays visible. */
  readonly fill?: boolean | undefined;
  /** No card chrome: the panel's own background shows through. */
  readonly flat?: boolean | undefined;
}) => {
  const [draft, setDraft] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>(initial.fields);
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [note, setNote] = useState<{ readonly text: string; readonly bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // A newer version from the chat (the AI stored answers): take it, keeping what the user is still typing.
  if (initial.updatedAt > draft.updatedAt) {
    setDraft(initial);
    setValues((v) => ({ ...initial.fields, ...Object.fromEntries([...dirty].map((k) => [k, v[k] ?? ""])) }));
  }

  const fields = FORM_FIELDS[draft.form];
  const groups = useMemo(() => [...new Set(fields.map((f) => f.group))], [fields]);
  const filled = fields.filter((f) => (values[f.key] ?? "").trim() !== "").length;
  const missingRequired = fields.filter((f) => f.required && !(values[f.key] ?? "").trim());

  const commit = async (key: string) => {
    if (!dirty.has(key)) return;
    try {
      const updated = await api.patch<FormDraft>(`/api/drafts/${draft.id}`, { fields: { [key]: values[key] ?? "" } });
      setDraft(updated);
      setDirty((d) => new Set([...d].filter((k) => k !== key)));
      setSaveError(null);
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  const fillInKhanza = async () => {
    if (!desktop) return;
    setBusy(true);
    setNote(null);
    try {
      const nonEmpty = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
      let result = await desktop.fillKhanza({ form: draft.form, noRawat: draft.noRawat, fields: nonEmpty });
      if (result.status === "not_configured" && (await desktop.chooseKhanzaLauncher())) {
        result = await desktop.fillKhanza({ form: draft.form, noRawat: draft.noRawat, fields: nonEmpty });
      }
      setNote(fillMessage(result));
    } catch (error) {
      setNote({ text: errorMessage(error), bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={cn("animate-rise @container overflow-hidden", !flat && "rounded-xl border border-line bg-card", fill && "flex h-full min-h-0 flex-col")}
      data-testid="draft-card"
    >
      <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-line-2 px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-amber-soft text-amber">
          <FilePenLine className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="amber">Draf</Badge>
            <h3 className="font-display text-[14.5px] leading-tight font-semibold">{FORM_TITLES[draft.form]}</h3>
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-2">{draft.subjek}</p>
          <p className="text-[11px] leading-snug text-ink-3">
            {filled} dari {fields.length} field terisi
            {missingRequired.length > 0 ? <span className="text-red"> · wajib belum: {missingRequired.map((f) => f.label).join(", ")}</span> : null}
            {" · "}diubah {formatDateTime(draft.updatedAt)}
          </p>
          {draft.existing ? (
            <p className="mt-1 text-[12px] text-amber">Resume untuk kunjungan ini sudah ada di Khanza; draf ini berisi resume itu. Di Khanza nanti klik Ganti, bukan Simpan.</p>
          ) : null}
        </div>
      </header>

      <div className={cn("divide-y divide-line-2", fill && "quiet-scroll min-h-0 flex-1 overflow-y-auto")}>
        {groups.map((group) => {
          const inGroup = fields.filter((f) => f.group === group);
          const groupFilled = inGroup.filter((f) => (values[f.key] ?? "").trim()).length;
          const needsWork = inGroup.some((f) => f.required && !(values[f.key] ?? "").trim());
          return (
            <Collapsible.Root key={group} defaultOpen={OPEN_GROUPS.has(group) || needsWork}>
              <Collapsible.Trigger className="group flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-ink hover:bg-paper/60">
                <ChevronRight className="size-3.5 text-ink-3 transition-transform group-data-[panel-open]:rotate-90" />
                {group}
                <span className="ml-auto font-mono text-[11px] font-normal text-ink-3">
                  {groupFilled}/{inGroup.length}
                </span>
              </Collapsible.Trigger>
              <Collapsible.Panel className="grid gap-3 px-3.5 pt-1 pb-4 @[520px]:grid-cols-2">
                {inGroup.map((field) => (
                  <Field
                    key={field.key}
                    field={field}
                    value={values[field.key] ?? ""}
                    source={dirty.has(field.key) ? "user" : draft.sources[field.key]}
                    onChange={(value) => {
                      setValues((v) => ({ ...v, [field.key]: value }));
                      setDirty((d) => new Set([...d, field.key]));
                    }}
                    onCommit={() => void commit(field.key)}
                  />
                ))}
              </Collapsible.Panel>
            </Collapsible.Root>
          );
        })}
      </div>

      <footer className="relative flex shrink-0 flex-wrap items-center gap-2 border-t border-line-2 bg-paper/70 px-3.5 py-3 backdrop-blur-sm">
        {desktop ? (
          <button
            type="button"
            onClick={() => void fillInKhanza()}
            disabled={busy}
            data-testid="fill-in-khanza"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-teal-2 px-3.5 text-[13.5px] font-medium text-paper hover:bg-teal disabled:opacity-60"
          >
            <AppWindow className="size-4" /> Isi di Khanza
          </button>
        ) : (
          <p className="text-[12.5px] text-ink-3">Buka percakapan ini di aplikasi desktop Simha untuk mengisi form ini di Khanza.</p>
        )}
        <p className="text-[12px] text-ink-3">Tidak tersimpan otomatis ke Khanza: periksa form di Khanza, lalu klik Simpan di sana.</p>
        {saveError ? <p className="w-full text-[12.5px] text-red">{saveError}</p> : null}
        {note ? (
          <p role="status" className={cn("w-full rounded-lg px-3 py-2 text-[12.5px]", note.bad ? "bg-red-soft text-red" : "bg-teal-soft text-teal")}>
            {note.text}
          </p>
        ) : null}
      </footer>
    </section>
  );
};

/**
 * AI provider: pick provider and model, test the connection, choose whether
 * patient data is masked. Only admins can save; the API key is never shown.
 */
import { Switch } from "@base-ui/react/switch";
import type { LlmSettingsView, LlmTestResult } from "@simha/shared";
import { CheckCircle2, PlugZap, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { ErrorText, Field, Input } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";

const PRESETS = [
  { provider: "anthropic", label: "Claude (Anthropic)", model: "claude-opus-5-5", baseUrl: "", local: false },
  { provider: "openai", label: "OpenAI", model: "", baseUrl: "", local: false },
  { provider: "ollama", label: "Ollama (lokal)", model: "qwen3", baseUrl: "http://localhost:11434/v1", local: true },
  { provider: "lmstudio", label: "LM Studio (lokal)", model: "", baseUrl: "http://localhost:1234/v1", local: true },
] as const;

export const LlmSettingsForm = ({ isAdmin }: { readonly isAdmin: boolean }) => {
  const current = useApi<LlmSettingsView>("/api/settings/llm");
  const [form, setForm] = useState({ provider: "", model: "", baseUrl: "", apiKey: "", maskPii: true });
  const [changeKey, setChangeKey] = useState(false);
  const [test, setTest] = useState<LlmTestResult | "running" | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (current.data) {
      setForm({ provider: current.data.provider, model: current.data.model, baseUrl: current.data.baseUrl ?? "", apiKey: "", maskPii: current.data.maskPii });
      setChangeKey(false);
    }
  }, [current.data]);

  const body = () => ({
    provider: form.provider,
    model: form.model,
    ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
    ...(changeKey ? { apiKey: form.apiKey } : {}),
    maskPii: form.maskPii,
  });

  const runTest = async () => {
    setTest("running");
    try {
      setTest(await api.post<LlmTestResult>("/api/settings/llm/test", body()));
    } catch (e) {
      setTest({ ok: false, reply: null, error: errorMessage(e), durationMs: 0 });
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      current.setData(await api.put<LlmSettingsView>("/api/settings/llm", body()));
      setMessage({ ok: true, text: "Tersimpan. Pertanyaan berikutnya memakai pengaturan ini." });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  if (!current.data) return current.error ? <ErrorText>{current.error}</ErrorText> : <Spinner className="text-ink-3" />;
  const set = (key: "provider" | "model" | "baseUrl" | "apiKey") => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <Panel
      title="Penyedia AI"
      actions={
        <span className="font-mono text-[11px] text-ink-3">
          {current.data.source === "env" ? "dari .env" : `diubah ${current.data.updatedBy ?? ""} · ${formatDateTime(current.data.updatedAt)}`}
        </span>
      }
    >
      <fieldset disabled={!isAdmin} className="flex max-w-2xl flex-col gap-4">
        {!isAdmin ? <p className="text-[13px] text-ink-3">Hanya admin yang bisa mengubah pengaturan AI.</p> : null}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.provider}
              type="button"
              onClick={() => setForm({ ...form, provider: p.provider, model: p.model || form.model, baseUrl: p.baseUrl, maskPii: p.local ? form.maskPii : true })}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${form.provider === p.provider ? "border-teal bg-teal-soft text-teal" : "border-line bg-card text-ink-2 hover:border-ink-3"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" hint="anthropic, openai, ollama, lmstudio, atau nama gateway lain yang OpenAI-compatible.">
            <Input value={form.provider} onChange={set("provider")} required />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={set("model")} className="font-mono text-[13px]" />
          </Field>
        </div>
        <Field label="Base URL" hint="Kosongkan untuk Anthropic/OpenAI resmi. Wajib untuk gateway lain.">
          <Input value={form.baseUrl} onChange={set("baseUrl")} placeholder="https://…/v1" className="font-mono text-[13px]" />
        </Field>
        <Field label="API key" hint={current.data.apiKeySet ? "Key sudah tersimpan dan tidak ditampilkan." : "Belum ada key."}>
          {changeKey ? (
            <Input type="password" autoComplete="off" value={form.apiKey} onChange={set("apiKey")} placeholder="Kosongkan untuk menghapus key" />
          ) : (
            <div>
              <Button size="sm" onClick={() => setChangeKey(true)}>
                {current.data.apiKeySet ? "Ganti key" : "Isi key"}
              </Button>
            </div>
          )}
        </Field>
        <label className="flex items-start gap-3 rounded-md border border-line-2 bg-paper/50 p-3">
          <Switch.Root
            checked={form.maskPii}
            onCheckedChange={(checked) => setForm({ ...form, maskPii: checked })}
            className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line transition-colors data-[checked]:bg-teal"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[checked]:translate-x-[18px]" />
          </Switch.Root>
          <span className="text-[13px]">
            <span className="font-medium">Samarkan NIK, telepon, alamat dan catatan klinis</span>
            <span className="block text-ink-3">Wajib untuk AI di luar rumah sakit: teks SOAP, hasil radiologi dan resume tidak dikirim, hanya diagnosis, tanda vital dan angka lab. Boleh dimatikan hanya untuk model yang berjalan di server sendiri.</span>
          </span>
        </label>

        {test && test !== "running" ? (
          <p className={`flex items-start gap-2 rounded-md px-3 py-2 text-[13px] ${test.ok ? "bg-ok-soft text-ok" : "bg-red-soft text-red"}`}>
            {test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            {test.ok ? `Terhubung (${test.durationMs} ms). Jawaban: “${test.reply}”` : test.error}
          </p>
        ) : null}
        {message ? <p className={`text-[13px] ${message.ok ? "text-ok" : "text-red"}`}>{message.text}</p> : null}

        <div className="flex gap-2">
          <Button onClick={() => void runTest()} disabled={test === "running"}>
            {test === "running" ? <Spinner /> : <PlugZap />} Tes koneksi
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner /> : null} Simpan
          </Button>
        </div>
      </fieldset>
    </Panel>
  );
};

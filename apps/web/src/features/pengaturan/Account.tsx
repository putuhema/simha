import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { ErrorText, Field, Input } from "../../components/ui/Field.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useAuth } from "../../stores/auth.ts";

export const Account = () => {
  const user = useAuth((s) => s.user);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.newPassword !== form.confirm) return setMessage({ ok: false, text: "Konfirmasi password tidak sama." });
    try {
      await api.post("/api/auth/password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setMessage({ ok: true, text: "Password diganti." });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  };

  return (
    <Panel title="Akun saya">
      <p className="mb-4 text-[13.5px]">
        {user?.displayName} · <span className="font-mono text-ink-2">{user?.username}</span> · {user?.role === "admin" ? "admin" : "staf IT"}
      </p>
      <form onSubmit={(e) => void submit(e)} className="flex max-w-sm flex-col gap-3">
        <Field label="Password sekarang">
          <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
        </Field>
        <Field label="Password baru" hint="Minimal 8 karakter.">
          <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required minLength={8} />
        </Field>
        <Field label="Ulangi password baru">
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required minLength={8} />
        </Field>
        {message && !message.ok ? <ErrorText>{message.text}</ErrorText> : null}
        {message?.ok ? <p className="text-[13px] text-ok">{message.text}</p> : null}
        <div>
          <Button type="submit" variant="primary">
            Ganti password
          </Button>
        </div>
      </form>
    </Panel>
  );
};

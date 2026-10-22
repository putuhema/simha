import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { ErrorText, Field, Input } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { errorMessage } from "../../lib/api.ts";
import { useAuth } from "../../stores/auth.ts";
import { AuthLayout } from "./AuthLayout.tsx";

/** First run: create the admin account. The server refuses this once any user exists. */
export const SetupPage = () => {
  const setup = useAuth((s) => s.setup);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) return setError("Konfirmasi password tidak sama.");
    setBusy(true);
    setError(null);
    try {
      await setup({ username: form.username.trim(), displayName: form.displayName.trim(), password: form.password });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Buat akun admin" subtitle="Belum ada pengguna. Akun pertama ini menjadi admin: bisa menambah petugas IT dan mengatur AI.">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field label="Nama lengkap">
          <Input autoFocus value={form.displayName} onChange={set("displayName")} required maxLength={100} />
        </Field>
        <Field label="Username" hint="3–32 huruf, angka, titik, minus atau garis bawah.">
          <Input autoComplete="username" value={form.username} onChange={set("username")} required pattern="[a-zA-Z0-9._\-]{3,32}" />
        </Field>
        <Field label="Password" hint="Minimal 8 karakter.">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required minLength={8} />
        </Field>
        <Field label="Ulangi password">
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required minLength={8} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Spinner /> : null} Buat akun dan masuk
        </Button>
      </form>
    </AuthLayout>
  );
};

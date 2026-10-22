import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { ErrorText, Field, Input } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { errorMessage } from "../../lib/api.ts";
import { useAuth } from "../../stores/auth.ts";
import { AuthLayout } from "./AuthLayout.tsx";

export const LoginPage = () => {
  const { login, error: sessionError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Masuk" subtitle="Gunakan akun petugas IT Anda.">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field label="Username">
          <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText>{error ?? sessionError}</ErrorText>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Spinner /> : null} Masuk
        </Button>
      </form>
    </AuthLayout>
  );
};

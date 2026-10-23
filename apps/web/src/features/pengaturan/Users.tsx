import type { Role, User } from "@simha/shared";
import { KeyRound, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { ErrorText, Field, Input } from "../../components/ui/Field.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";
import { useAuth } from "../../stores/auth.ts";

/** Admin: add IT staff, change roles, disable accounts, reset passwords. */
export const Users = () => {
  const me = useAuth((s) => s.user);
  const users = useApi<ReadonlyArray<User>>("/api/users");
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = async (user: User, change: { role?: Role; active?: boolean; password?: string }) => {
    setError(null);
    try {
      await api.patch(`/api/users/${user.id}`, change);
      await users.reload();
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    }
  };

  return (
    <Panel
      title="Pengguna"
      actions={
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <UserPlus /> Tambah
        </Button>
      }
    >
      <ErrorText>{error ?? users.error}</ErrorText>
      <ul className="divide-y divide-line-2">
        {users.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-48 flex-1">
              <p className="font-medium">
                {u.displayName} {u.id === me?.id ? <span className="text-[12px] font-normal text-ink-3">(Anda)</span> : null}
              </p>
              <p className="font-mono text-[12px] text-ink-3">
                {u.username} · sejak {formatDateTime(u.createdAt)}
              </p>
            </div>
            <Badge tone={u.role === "admin" ? "ink" : "neutral"}>{u.role === "admin" ? "Admin" : "Staf IT"}</Badge>
            {!u.active ? <Badge tone="red">Nonaktif</Badge> : null}
            {u.id !== me?.id ? (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void update(u, { role: u.role === "admin" ? "staff" : "admin" })}>
                  {u.role === "admin" ? "Jadikan staf" : "Jadikan admin"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void update(u, { active: !u.active })}>
                  {u.active ? "Nonaktifkan" : "Aktifkan"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResetFor(u)}>
                  <KeyRound /> Reset password
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <AddUserDialog open={adding} onOpenChange={setAdding} onAdded={() => void users.reload()} />
      {resetFor ? (
        <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} onReset={(password) => update(resetFor, { password })} />
      ) : null}
    </Panel>
  );
};

const AddUserDialog = ({ open, onOpenChange, onAdded }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onAdded: () => void }) => {
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "staff" as Role });
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.post("/api/users", { ...form, username: form.username.trim(), displayName: form.displayName.trim() });
      setForm({ username: "", displayName: "", password: "", role: "staff" });
      setError(null);
      onAdded();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Tambah pengguna">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Nama lengkap">
          <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
        </Field>
        <Field label="Username">
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required pattern="[a-zA-Z0-9._\-]{3,32}" />
        </Field>
        <Field label="Password awal" hint="Minimal 8 karakter. Minta pengguna menggantinya setelah login.">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
        </Field>
        <Field label="Peran">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="h-9 rounded-md border border-line bg-card px-2 text-[14px]"
          >
            <option value="staff">Staf IT</option>
            <option value="admin">Admin (kelola pengguna dan AI)</option>
          </select>
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="submit" variant="primary">
            Tambah
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

const ResetPasswordDialog = ({ user, onClose, onReset }: { readonly user: User; readonly onClose: () => void; readonly onReset: (password: string) => Promise<void> }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={`Reset password ${user.username}`} description="Semua sesi pengguna ini akan berakhir.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onReset(password).then(onClose, (err: unknown) => setError(errorMessage(err)));
        }}
        className="flex flex-col gap-3"
      >
        <Field label="Password baru">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="danger">
            Reset
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

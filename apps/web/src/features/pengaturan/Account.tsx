/**
 * Read-only account page. The account and its password live in SIMRS Khanza;
 * Simha only shows the rights snapshot it read at login and can re-read it
 * after IT changed the account in Khanza.
 */
import { FIX_TABLE_RIGHTS, FIX_TABLES, type Permissions } from "@simha/shared";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { ErrorText } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useAuth } from "../../stores/auth.ts";

/** Harness feature -> the Khanza right that gates it. */
const FEATURE_RIGHTS = [
  { key: "cpptRalan", label: "CPPT / SOAP rawat jalan", right: "tindakan_ralan" },
  { key: "cpptRanap", label: "CPPT / SOAP rawat inap", right: "tindakan_ranap" },
  { key: "resume", label: "Resume medis", right: "data_resume_pasien" },
  { key: "radiology", label: "Radiologi dan gambar PACS", right: "periksa_radiologi" },
  { key: "berkas", label: "Berkas digital", right: "berkas_digital_perawatan" },
] as const satisfies ReadonlyArray<{
  readonly key: Exclude<keyof Permissions, "fixTables">;
  readonly label: string;
  readonly right: string;
}>;

const Granted = ({ granted }: { readonly granted: boolean }) =>
  granted ? <Badge tone="ok">Boleh</Badge> : <Badge tone="neutral">Tidak</Badge>;

export const Account = () => {
  const user = useAuth((s) => s.user);
  const refreshAccess = useAuth((s) => s.refreshAccess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!user) return null;

  const refresh = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await refreshAccess();
      setMessage("Hak akses dimuat ulang dari SIMRS.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        useAuth.setState({ status: "login", user: null, error: "Akun ini sudah tidak ada di SIMRS. Silakan login lagi." });
        return;
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Akun SIMRS"
        actions={
          <Button size="sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? <Spinner className="size-3" /> : <RefreshCw />} Muat ulang hak
          </Button>
        }
      >
        <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
          <div>
            <dt className="text-ink-3">Nama tampilan</dt>
            <dd className="font-medium">{user.displayName}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Username</dt>
            <dd className="font-mono">{user.username}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Peran</dt>
            <dd>
              {user.khanzaAdmin ? <Badge tone="ink">Admin Utama SIMRS</Badge> : <Badge tone="neutral">Pengguna SIMRS</Badge>}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Akun di Simha sejak</dt>
            <dd>{formatDateTime(user.createdAt)}</dd>
          </div>
        </dl>
        {user.employeeName !== null || user.doctorName !== null || user.staffName !== null ? (
          <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-line-2 pt-3 text-[13.5px] sm:grid-cols-2">
            {user.employeeName !== null ? (
              <div>
                <dt className="text-ink-3">Nama pegawai</dt>
                <dd className="font-medium">{user.employeeName}</dd>
              </div>
            ) : null}
            {user.doctorName !== null ? (
              <div>
                <dt className="text-ink-3">Nama dokter</dt>
                <dd className="font-medium">{user.doctorName}</dd>
              </div>
            ) : null}
            {user.staffName !== null ? (
              <div>
                <dt className="text-ink-3">Nama petugas / perawat</dt>
                <dd className="font-medium">{user.staffName}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <p className="mt-4 rounded-md border border-line-2 bg-paper/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          Password dan hak akses dikelola di Khanza (menu <span className="font-mono">T/Set User</span> atau{" "}
          <span className="font-mono">T/Set Admin</span>). Hak dibaca saat login; setelah IT mengubahnya, klik{" "}
          <strong>Muat ulang hak</strong>. Akun Admin Utama SIMRS mendapat semua hak.
        </p>
        {error ? <div className="mt-3"><ErrorText>{error}</ErrorText></div> : null}
        {message ? <p className="mt-3 text-[13px] text-ok">{message}</p> : null}
      </Panel>

      <Panel title="Hak akses">
        <ul className="divide-y divide-line-2">
          {FEATURE_RIGHTS.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{row.label}</p>
                <p className="font-mono text-[11.5px] text-ink-3">{row.right}</p>
              </div>
              <Granted granted={user.permissions[row.key]} />
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-line-2 pt-4">
          <p className="text-[13.5px] font-medium">Menyetujui perbaikan data</p>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Perubahan pada tabel Khanza mengikuti hak menu yang menulis tabel itu.
          </p>
          <ul className="mt-2 divide-y divide-line-2">
            {FIX_TABLES.map((table) => (
              <li key={table} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[12.5px]">{table}</p>
                  <p className="text-[11.5px] text-ink-3">{(FIX_TABLE_RIGHTS[table] ?? []).join(" / ")}</p>
                </div>
                <Granted granted={user.permissions.fixTables.includes(table)} />
              </li>
            ))}
          </ul>
        </div>

        {user.khanzaAdmin ? (
          <p className="mt-4 text-[12.5px] text-ink-2">
            Sebagai Admin Utama SIMRS, akun ini juga boleh mengubah pengaturan AI dan meninjau pengetahuan AI.
          </p>
        ) : null}
      </Panel>

      <Panel title="Hak Khanza">
        {user.khanzaAdmin ? (
          <p className="text-[13px] text-ink-2">
            Admin Utama SIMRS: semua menu dan hak di Khanza boleh dipakai.
          </p>
        ) : user.rights.length === 0 ? (
          <p className="text-[13px] text-ink-2">
            Belum ada hak Khanza yang terbaca pada akun ini. Minta IT memeriksa baris <span className="font-mono">user</span> di Khanza.
          </p>
        ) : (
          <details>
            <summary className="cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink">
              Lihat {user.rights.length} hak Khanza yang terbaca
            </summary>
            <ul className="mt-2 grid max-h-64 gap-x-4 gap-y-1 overflow-y-auto rounded-md bg-paper/60 p-2.5 font-mono text-[11.5px] text-ink-2 sm:grid-cols-2">
              {user.rights.map((right) => (
                <li key={right} className="truncate" title={right}>
                  {right}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>
    </div>
  );
};

/**
 * Pemeriksaan data (M5.2): the scheduled read-only checks for known Khanza
 * data problems, with the findings in plain Indonesian and one click to open
 * an investigation in Tanya Data.
 *
 * The report is built by the server and stored in the audit DB; this page only
 * reads it. "Jalankan sekarang" is for admins (it scans the whole database).
 */
import type { CheckHit, CheckReport, CheckResult, CheckRun } from "@simha/shared";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert, CircleX, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ErrorText } from "../../components/ui/Field.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatDateTime, formatDuration, formatRelative } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";
import { bumpChecks } from "../../stores/refresh.ts";
import { useAuth } from "../../stores/auth.ts";

const severityTone = { kritis: "red", peringatan: "amber", info: "neutral" } as const;
const severityLabel = { kritis: "Kritis", peringatan: "Peringatan", info: "Info" } as const;

const triggerLabel = { schedule: "otomatis", manual: "manual", startup: "saat mulai" } as const;

const statusIcon = (status: CheckResult["status"]) => {
  if (status === "ok") return <CheckCircle2 className="size-4 text-ok" aria-hidden />;
  if (status === "gagal") return <CircleX className="size-4 text-red" aria-hidden />;
  return <CircleAlert className="size-4 text-amber" aria-hidden />;
};

/** A question the investigation mode can act on: names the visit, the check and the finding. */
const investigateQuestion = (check: CheckResult, hit: CheckHit) => {
  const subject = hit.noRawat
    ? `Kunjungan ${hit.noRawat}${hit.noRm ? ` (RM ${hit.noRm})` : ""}.`
    : "";
  return `${subject} Pemeriksaan "${check.title}" menemukan: ${hit.keterangan}. Selidiki penyebabnya dan usulkan perbaikan bila perlu.`.trim();
};

const Stat = ({ label, value, hint }: { readonly label: string; readonly value: string | number; readonly hint?: string }) => (
  <div className="rounded-lg border border-line bg-card px-3.5 py-3">
    <p className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-ink-3 uppercase">{label}</p>
    <p className="mt-1 font-display text-[23px] leading-none font-semibold tracking-tight tabular-nums">{value}</p>
    {hint === undefined ? null : <p className="mt-1.5 text-[11.5px] text-ink-3">{hint}</p>}
  </div>
);

const HitTable = ({ check, onInvestigate }: { readonly check: CheckResult; readonly onInvestigate: (check: CheckResult, hit: CheckHit) => void }) => (
  <div className="overflow-x-auto rounded-md border border-line-2">
    <table className="w-full border-collapse text-[12.5px]">
      <thead className="bg-paper-2 text-left font-mono text-[11px] font-medium text-ink-2">
        <tr>
          <th className="border-b border-line px-2.5 py-1.5 whitespace-nowrap">No. rawat</th>
          <th className="border-b border-line px-2.5 py-1.5">Pasien</th>
          <th className="border-b border-line px-2.5 py-1.5">Temuan</th>
          <th className="border-b border-line px-2.5 py-1.5" />
        </tr>
      </thead>
      <tbody>
        {check.sample.map((hit, index) => (
          <tr key={`${hit.noRawat ?? "kamar"}-${index}`} className="align-top">
            <td className="border-b border-line-2 px-2.5 py-1.5 font-mono text-[11.5px] whitespace-nowrap last:border-0">
              {hit.noRawat ?? "–"}
              {hit.noRm ? <span className="block text-[10.5px] text-ink-3">RM {hit.noRm}</span> : null}
            </td>
            <td className="border-b border-line-2 px-2.5 py-1.5 last:border-0">{hit.pasien ?? "–"}</td>
            <td className="border-b border-line-2 px-2.5 py-1.5 text-ink-2 last:border-0">{hit.keterangan}</td>
            <td className="border-b border-line-2 px-2.5 py-1.5 text-right whitespace-nowrap last:border-0">
              <Button size="sm" variant="ghost" onClick={() => onInvestigate(check, hit)}>
                Selidiki
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const CheckBlock = ({
  check,
  onInvestigate,
}: {
  readonly check: CheckResult;
  readonly onInvestigate: (check: CheckResult, hit: CheckHit) => void;
}) => (
  <section data-testid="check-block" data-check={check.id} className="rounded-lg border border-line bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5">{statusIcon(check.status)}</span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-ink">{check.title}</h3>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-ink-3">{check.description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge tone={severityTone[check.severity]}>{severityLabel[check.severity]}</Badge>
        {check.status === "masalah" ? (
          <Badge tone="amber" className="normal-case tracking-normal">
            {check.count} temuan
          </Badge>
        ) : null}
      </div>
    </div>

    {check.status === "gagal" ? (
      <div className="mt-3">
        <ErrorText>{check.error ?? "Pemeriksaan ini gagal dijalankan."}</ErrorText>
      </div>
    ) : null}

    {check.status === "masalah" ? (
      <div className="mt-3 space-y-2">
        <HitTable check={check} onInvestigate={onInvestigate} />
        {check.count > check.sample.length ? (
          <p className="text-[11.5px] text-ink-3">
            Menampilkan {check.sample.length} dari {check.count} temuan. Perbaiki yang pertama dulu, lalu jalankan lagi.
          </p>
        ) : null}
        <p className="rounded-md border border-line-2 bg-paper/60 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">Saran: </span>
          {check.advice}
        </p>
      </div>
    ) :null}

    <p className="mt-2 font-mono text-[10.5px] text-ink-3">{formatDuration(check.durationMs)}</p>
  </section>
);

export const PemeriksaanPage = () => {
  const report = useApi<CheckReport>("/api/checks");
  const isAdmin = useAuth((state) => state.user?.role === "admin");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOk, setShowOk] = useState(false);

  const latest: CheckRun | null = report.data?.latest ?? null;
  const issues = latest?.checks.filter((check) => check.status !== "ok") ?? [];
  const okay = latest?.checks.filter((check) => check.status === "ok") ?? [];

  const runNow = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post<CheckRun>("/api/checks/run");
      await report.reload();
      bumpChecks();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const investigate = (check: CheckResult, hit: CheckHit) => {
    void navigate({ to: "/tanya", search: { q: investigateQuestion(check, hit), mode: "investigasi" } });
  };

  return (
    <div className="quiet-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pt-6 pb-10 sm:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[24px] font-semibold tracking-tight">Pemeriksaan data</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
              Pemeriksaan read-only untuk masalah data Khanza yang sudah dikenal. Tidak ada yang diubah; temuan bisa
              langsung diselidiki di Tanya Data.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void report.reload()} disabled={report.loading || busy}>
              <RefreshCw className={report.loading ? "animate-spin" : ""} /> Muat ulang
            </Button>
            {isAdmin ? (
              <Button variant="primary" size="sm" onClick={() => void runNow()} disabled={busy || report.loading}>
                {busy ? <Spinner className="size-4" /> : <ShieldCheck />} Jalankan sekarang
              </Button>
            ) : null}
          </div>
        </div>

        {report.error ? <ErrorText>{report.error}</ErrorText> : null}
        {actionError ? <ErrorText>{actionError}</ErrorText> : null}

        {report.loading && latest === null ? (
          <div className="grid place-items-center py-16 text-ink-3">
            <Spinner className="size-6" />
          </div>
        ) : latest === null ? (
          <div className="rounded-lg border border-line bg-card px-5 py-10 text-center">
            <TriangleAlert className="mx-auto size-6 text-amber" />
            <p className="mt-2 text-[14px] font-medium">Belum ada pemeriksaan.</p>
            <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-2">
              {isAdmin
                ? "Jalankan sekarang untuk memeriksa data Khanza. Berikutnya pemeriksaan berjalan otomatis sesuai jadwal."
                : "Pemeriksaan berjalan otomatis sesuai jadwal. Minta admin menjalankannya sekarang bila perlu."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Masalah" value={latest.masalah} hint={`dari ${latest.checks.length} pemeriksaan`} />
              <Stat
                label="Temuan"
                value={latest.checks.reduce((sum, check) => sum + (check.status === "masalah" ? check.count : 0), 0)}
                hint="baris data"
              />
              <Stat label="Gagal" value={latest.gagal} hint={latest.gagal > 0 ? "periksa error di bawah" : "semua berjalan"} />
              <Stat
                label="Terakhir"
                value={formatRelative(latest.startedAt)}
                hint={`${formatDateTime(latest.startedAt)} · ${formatDuration(latest.durationMs)}`}
              />
            </div>

            {latest.status === "gagal" && latest.error ? <ErrorText>{latest.error}</ErrorText> : null}

            {issues.length === 0 ? (
              <section className="rounded-lg border border-ok/25 bg-ok-soft/30 px-5 py-8 text-center">
                <CheckCircle2 className="mx-auto size-6 text-ok" />
                <p className="mt-2 text-[14px] font-medium">Tidak ada masalah data yang dikenal.</p>
                <p className="mt-1 text-[12.5px] text-ink-2">
                  {latest.checks.length} pemeriksaan berjalan pada {formatDateTime(latest.startedAt)}.
                </p>
              </section>
            ) : (
              <div className="space-y-3">
                {issues.map((check) => (
                  <CheckBlock key={check.id} check={check} onInvestigate={investigate} />
                ))}
              </div>
            )}

            {okay.length > 0 ? (
              <section>
                <button
                  type="button"
                  onClick={() => setShowOk(!showOk)}
                  aria-expanded={showOk}
                  className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink"
                >
                  <CheckCircle2 className="size-4 text-ok" />
                  Aman ({okay.length})
                  <span className="text-ink-3">{showOk ? "sembunyikan" : "tampilkan"}</span>
                </button>
                {showOk ? (
                  <ul className="mt-2 space-y-px rounded-lg border border-line bg-card px-3 py-1">
                    {okay.map((check) => (
                      <li key={check.id} className="flex items-center justify-between gap-2 border-b border-line-2 py-1.5 text-[12.5px] last:border-0">
                        <span className="text-ink-2">{check.title}</span>
                        <span className="text-[11px] text-ink-3">0 temuan · {formatDuration(check.durationMs)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {report.data && report.data.history.length > 1 ? (
              <section className="rounded-lg border border-line bg-card">
                <h2 className="eyebrow border-b border-line-2 px-4 py-2.5">Riwayat pemeriksaan</h2>
                <ul className="divide-y divide-line-2">
                  {report.data.history.slice(0, 8).map((run) => (
                    <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[12.5px]">
                      <span className="flex min-w-0 items-center gap-2">
                        {run.id === latest.id ? <Badge tone="teal">Terbaru</Badge> : null}
                        <span className="text-ink-2">{formatDateTime(run.startedAt)}</span>
                        <span className="text-[11px] text-ink-3">{triggerLabel[run.trigger]}</span>
                        {run.actor ? <span className="font-mono text-[10.5px] text-ink-3">{run.actor}</span> : null}
                      </span>
                      <span className="flex items-center gap-2">
                        {run.gagal > 0 ? <Badge tone="red">{run.gagal} gagal</Badge> : null}
                        <Badge tone={run.masalah > 0 ? "amber" : "ok"}>{run.masalah} masalah</Badge>
                        <span className="font-mono text-[10.5px] text-ink-3">{formatDuration(run.durationMs)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

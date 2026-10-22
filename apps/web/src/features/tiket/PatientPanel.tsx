/**
 * Right column: the patient the ticket is about (identity, current visit,
 * DPJP), the visit timeline, and the AI's diagnosis in one paragraph.
 */
import { BedDouble, Stethoscope, UserRound } from "lucide-react";
import { Markdown } from "../../components/agent/Markdown.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { Empty, Spinner } from "../../components/ui/Spinner.tsx";
import { useApi } from "../../lib/useApi.ts";

interface Visit {
  readonly no_rawat: string;
  readonly tgl_registrasi: string | null;
  readonly status_lanjut: string;
  readonly stts: string | null;
  readonly status_bayar: string;
  readonly nm_poli: string | null;
  readonly nm_dokter: string | null;
  readonly png_jawab: string | null;
  readonly kamar_aktif: string | null;
}

interface PatientCard {
  readonly pasien: {
    readonly no_rkm_medis: string;
    readonly nm_pasien: string | null;
    readonly jk: string | null;
    readonly umur: string | null;
    readonly png_jawab: string | null;
  };
  readonly kunjungan: ReadonlyArray<Visit>;
  readonly dpjp: ReadonlyArray<{ readonly nm_dokter: string | null; readonly kd_dokter: string }>;
}

const Row = ({ label, children }: { readonly label: string; readonly children: React.ReactNode }) => (
  <div className="flex justify-between gap-3 border-b border-dashed border-line-2 py-1.5 text-[13px] last:border-0">
    <dt className="text-ink-3">{label}</dt>
    <dd className="text-right font-medium">{children}</dd>
  </div>
);

export const PatientPanel = ({ rm, summary }: { readonly rm: string | undefined; readonly summary: string }) => {
  const card = useApi<PatientCard>(rm ? `/api/patients/${encodeURIComponent(rm)}` : null);
  const visit = card.data?.kunjungan[0];
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Pasien">
        {!rm ? (
          <Empty title="Belum ada pasien">Pasien muncul setelah AI menemukan nomor RM.</Empty>
        ) : card.loading && !card.data ? (
          <Spinner className="text-ink-3" />
        ) : card.error ? (
          <p className="text-[13px] text-ink-3">{card.error}</p>
        ) : card.data ? (
          <div data-testid="patient-card">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-teal-soft text-teal">
                <UserRound className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-[17px] font-semibold">{card.data.pasien.nm_pasien}</p>
                <p className="font-mono text-[12px] text-ink-3">
                  RM {card.data.pasien.no_rkm_medis} · {card.data.pasien.jk ?? "?"} · {card.data.pasien.umur ?? ""}
                </p>
              </div>
            </div>
            <dl>
              <Row label="No. rawat">{visit ? <span className="font-mono text-[12.5px]">{visit.no_rawat}</span> : "–"}</Row>
              <Row label="Penjamin">{visit?.png_jawab ?? card.data.pasien.png_jawab ?? "–"}</Row>
              <Row label="Kamar sekarang">
                {visit?.kamar_aktif ? (
                  <span className="inline-flex items-center gap-1">
                    <BedDouble className="size-3.5 text-teal" /> {visit.kamar_aktif}
                  </span>
                ) : (
                  "–"
                )}
              </Row>
              <Row label="DPJP">
                {card.data.dpjp.length > 0 ? (
                  card.data.dpjp.map((d) => d.nm_dokter ?? d.kd_dokter).join(", ")
                ) : visit?.nm_dokter ? (
                  <span className="inline-flex items-center gap-1">
                    <Stethoscope className="size-3.5 text-ink-3" /> {visit.nm_dokter}
                  </span>
                ) : (
                  "–"
                )}
              </Row>
            </dl>
          </div>
        ) : null}
      </Panel>

      {card.data && card.data.kunjungan.length > 0 ? (
        <Panel title="Riwayat kunjungan">
          <ol className="relative space-y-3 before:absolute before:top-1.5 before:bottom-1.5 before:left-[4.5px] before:w-px before:bg-line">
            {card.data.kunjungan.map((k, i) => (
              <li key={k.no_rawat} className="relative pl-5">
                <span className={`absolute top-1.5 left-0 size-2.5 rounded-full border-2 ${i === 0 ? "border-teal bg-teal" : "border-line bg-card"}`} />
                <p className="font-mono text-[11.5px] text-ink-3">
                  {k.tgl_registrasi ?? "?"} · {k.no_rawat}
                </p>
                <p className="text-[13px]">
                  <span className="font-medium">{k.status_lanjut === "Ranap" ? "Rawat inap" : "Rawat jalan"}</span>
                  {k.nm_poli ? ` · ${k.nm_poli}` : ""}
                </p>
                <p className="text-[12px] text-ink-2">
                  {k.stts ?? ""} · {k.status_bayar}
                  {k.kamar_aktif ? ` · ${k.kamar_aktif}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {summary ? (
        <Panel title="Ringkasan AI">
          <Markdown text={summary} className="text-[13px]" />
        </Panel>
      ) : null}
    </div>
  );
};

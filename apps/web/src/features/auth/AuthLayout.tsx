import type { ReactNode } from "react";

const RULES = [
  ["Read-only", "AI hanya membaca data Khanza dengan user SELECT."],
  ["Persetujuan", "Perubahan data hanya jalan setelah petugas IT menyetujui."],
  ["Rollback", "Setiap perbaikan menyimpan data lama dan bisa dibatalkan."],
  ["Audit", "Semua pertanyaan, query dan persetujuan tercatat."],
] as const;

/** Split screen: the safety rules on the dark side, the form on paper. */
export const AuthLayout = ({ title, subtitle, children }: { readonly title: string; readonly subtitle: string; readonly children: ReactNode }) => (
  <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
    <aside className="relative hidden overflow-hidden bg-teal-2 p-10 text-paper lg:flex lg:flex-col lg:justify-between">
      <svg aria-hidden viewBox="0 0 600 120" className="absolute top-[22%] left-0 w-[140%] opacity-[0.12]" fill="none">
        <path
          d="M0 60h150l14-30 18 60 16-80 16 90 14-40h40l10-14 10 14h300"
          stroke="#5eead4"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="relative flex items-center gap-2">
        <img src="/favicon.svg" alt="" className="size-8" />
        <span className="font-display text-[20px] font-semibold">SIMRS Harness</span>
      </div>
      <div className="relative">
        <p className="font-display text-[34px] leading-[1.1] font-semibold tracking-tight">
          Asisten IT untuk SIMRS Khanza.
          <br />
          <span className="text-[#5eead4]">Tidak ada yang berubah tanpa persetujuan.</span>
        </p>
        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
          {RULES.map(([term, text]) => (
            <div key={term}>
              <dt className="font-display text-[12px] font-semibold tracking-[0.12em] text-[#5eead4] uppercase">{term}</dt>
              <dd className="mt-0.5 text-paper/75">{text}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="relative text-[12px] text-paper/50">Berjalan di jaringan rumah sakit. Data pasien tidak keluar tanpa disamarkan.</p>
    </aside>
    <main className="flex items-center justify-center p-6">
      <div className="w-full max-w-sm animate-rise">
        <h1 className="font-display text-[28px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 mb-6 text-[13.5px] text-ink-2">{subtitle}</p>
        {children}
      </div>
    </main>
  </div>
);

/** Pengaturan → Desktop (desktop app only): the server connection and the file that starts Khanza. */
import { AppWindow, FolderOpen, Server, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { OpenInKhanza } from "../../components/desktop/OpenInKhanza.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Panel } from "../../components/ui/Card.tsx";
import { desktop, type DesktopInfo } from "../../lib/desktop.ts";

const Row = ({ label, children }: { readonly label: string; readonly children: React.ReactNode }) => (
  <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-line-2 py-2.5 text-[13.5px] last:border-0">
    <dt className="text-ink-3">{label}</dt>
    <dd className="min-w-0">{children}</dd>
  </div>
);

export const DesktopSettings = () => {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    void desktop?.info().then(setInfo);
  }, []);
  if (!desktop || !info) return null;
  const bridge = desktop;

  const choose = async () => {
    if (await bridge.chooseKhanzaLauncher()) setInfo(await bridge.info());
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Koneksi server">
        <dl>
          <Row label="Mode">
            <span className="inline-flex items-center gap-1.5">
              <Server className="size-3.5 text-ink-3" />
              {info.mode === "local" ? "Server di komputer ini" : "Server di jaringan RS"}
            </span>
          </Row>
          <Row label="Alamat">
            <span className="font-mono text-[12.5px]">{info.mode === "local" ? `http://127.0.0.1:${info.port}` : info.serverUrl}</span>
          </Row>
          <Row label="Versi aplikasi">{info.version}</Row>
        </dl>
        <Button size="sm" className="mt-3" onClick={() => void bridge.openSetup()}>
          Ubah koneksi…
        </Button>
      </Panel>

      <Panel title="Buka Khanza">
        <p className="mb-3 text-[13px] text-ink-2">
          Tombol <b>Buka di Khanza</b> membawa jendela Khanza ke depan (atau membukanya) dan menyalin no. rawat / no. RM, jadi tinggal ditempel di
          pencarian Khanza.
        </p>
        <dl>
          <Row label="File Khanza">
            {info.khanzaLauncher ? (
              <span className="block truncate font-mono text-[12.5px]" title={info.khanzaLauncher}>
                {info.khanzaLauncher}
              </span>
            ) : (
              <span className="text-ink-3">Belum dipilih</span>
            )}
          </Row>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void choose()}>
            <FolderOpen /> Pilih file…
          </Button>
          {info.khanzaLauncher ? <OpenInKhanza copy={null} label="Tes buka Khanza" /> : null}
          <Button size="sm" variant="ghost" onClick={() => void bridge.showKhanzaOutput()}>
            <SquareTerminal /> Lihat output Khanza
          </Button>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-ink-3">
          <AppWindow className="mt-0.5 size-3.5 shrink-0" />
          Biasanya file .bat di folder instalasi Khanza. Kalau Khanza sudah terbuka, jendelanya dibawa ke depan, tidak dibuka dua kali.
          Semua yang ditulis Khanza saat dibuka dari sini tersimpan dan bisa dilihat di tab “Output Khanza” pada terminal (Ctrl+`).
        </p>
      </Panel>
    </div>
  );
};

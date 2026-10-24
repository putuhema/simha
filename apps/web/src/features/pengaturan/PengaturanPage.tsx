import { Tabs } from "@base-ui/react/tabs";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAuth } from "../../stores/auth.ts";
import { desktop } from "../../lib/desktop.ts";
import { PengetahuanPanel } from "../pengetahuan/PengetahuanPanel.tsx";
import { Account } from "./Account.tsx";
import { AuditLog } from "./AuditLog.tsx";
import { DesktopSettings } from "./DesktopSettings.tsx";
import { LlmSettingsForm } from "./LlmSettingsForm.tsx";

export type SettingsTab = "ai" | "audit" | "akun" | "desktop" | "pengetahuan";

const tabClass =
  "relative px-3 py-2 text-[13.5px] whitespace-nowrap text-ink-2 outline-none hover:text-ink data-[active]:font-medium data-[active]:text-ink focus-visible:ring-2 focus-visible:ring-teal";

export const PengaturanPage = () => {
  const { tab = "ai" } = useSearch({ from: "/shell/pengaturan" });
  const navigate = useNavigate();
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  return (
    <div className="quiet-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pt-6 pb-10 sm:px-8">
        <h1 className="mb-4 font-display text-[24px] font-semibold tracking-tight">Pengaturan</h1>
        <Tabs.Root value={tab} onValueChange={(value: SettingsTab) => void navigate({ to: "/pengaturan", search: { tab: value } })}>
          <Tabs.List className="relative mb-4 flex gap-1 overflow-x-auto border-b border-line">
            <Tabs.Tab value="ai" className={tabClass}>
              AI
            </Tabs.Tab>
            <Tabs.Tab value="audit" className={tabClass}>
              Audit log
            </Tabs.Tab>
            <Tabs.Tab value="akun" className={tabClass}>
              Akun
            </Tabs.Tab>
            {desktop ? (
              <Tabs.Tab value="desktop" className={tabClass}>
                Desktop
              </Tabs.Tab>
            ) : null}
            <Tabs.Tab value="pengetahuan" className={tabClass}>
              Pengetahuan AI
            </Tabs.Tab>
            <Tabs.Indicator className="absolute bottom-[-1px] left-[var(--active-tab-left)] h-0.5 w-[var(--active-tab-width)] bg-teal transition-all duration-200" />
          </Tabs.List>
          <Tabs.Panel value="ai">
            <LlmSettingsForm isAdmin={isAdmin} />
          </Tabs.Panel>
          <Tabs.Panel value="audit">
            <AuditLog />
          </Tabs.Panel>
          <Tabs.Panel value="akun">
            <Account />
          </Tabs.Panel>
          {desktop ? (
            <Tabs.Panel value="desktop">
              <DesktopSettings />
            </Tabs.Panel>
          ) : null}
          <Tabs.Panel value="pengetahuan">
            <PengetahuanPanel />
          </Tabs.Panel>
        </Tabs.Root>
      </div>
    </div>
  );
};

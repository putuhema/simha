import { Tabs } from "@base-ui/react/tabs";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAuth } from "../../stores/auth.ts";
import { Account } from "./Account.tsx";
import { AuditLog } from "./AuditLog.tsx";
import { LlmSettingsForm } from "./LlmSettingsForm.tsx";
import { Users } from "./Users.tsx";

export type SettingsTab = "ai" | "audit" | "pengguna" | "akun";

const tabClass =
  "relative px-3 py-2 text-[13.5px] text-ink-2 outline-none hover:text-ink data-[active]:font-medium data-[active]:text-ink focus-visible:ring-2 focus-visible:ring-teal";

export const PengaturanPage = () => {
  const { tab = "ai" } = useSearch({ from: "/shell/pengaturan" });
  const navigate = useNavigate();
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  return (
    <Tabs.Root value={tab} onValueChange={(value: SettingsTab) => void navigate({ to: "/pengaturan", search: { tab: value } })}>
      <Tabs.List className="relative mb-4 flex gap-1 border-b border-line">
        <Tabs.Tab value="ai" className={tabClass}>
          AI
        </Tabs.Tab>
        <Tabs.Tab value="audit" className={tabClass}>
          Audit log
        </Tabs.Tab>
        {isAdmin ? (
          <Tabs.Tab value="pengguna" className={tabClass}>
            Pengguna
          </Tabs.Tab>
        ) : null}
        <Tabs.Tab value="akun" className={tabClass}>
          Akun
        </Tabs.Tab>
        <Tabs.Indicator className="absolute bottom-[-1px] left-[var(--active-tab-left)] h-0.5 w-[var(--active-tab-width)] bg-teal transition-all duration-200" />
      </Tabs.List>
      <Tabs.Panel value="ai">
        <LlmSettingsForm isAdmin={isAdmin} />
      </Tabs.Panel>
      <Tabs.Panel value="audit">
        <AuditLog />
      </Tabs.Panel>
      {isAdmin ? (
        <Tabs.Panel value="pengguna">
          <Users />
        </Tabs.Panel>
      ) : null}
      <Tabs.Panel value="akun">
        <Account />
      </Tabs.Panel>
    </Tabs.Root>
  );
};

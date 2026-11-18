import type { ReactNode } from "react";
import { ModulePage } from "@/components/layout/module-page";
import { AiSettingsTab } from "@/features/settings/ai-settings-tab";
import { IntegrationsTab } from "@/features/settings/integrations-tab";
import { ConnectedAccountsTab } from "@/features/settings/connected-accounts-tab";
import { AppTab } from "@/features/settings/app-tab";
import { SharingTab } from "@/features/settings/sharing-tab";
import { UsersTab } from "@/features/settings/users-tab";

const TABS: Record<string, () => ReactNode> = {
  app: () => <AppTab />,
  users: () => <UsersTab />,
  sharing: () => <SharingTab />,
  api: () => <AiSettingsTab />,
  integrations: () => <IntegrationsTab />,
  accounts: () => <ConnectedAccountsTab />,
};

export function Component() {
  return (
    <ModulePage module="settings">
      {(tab) => <div className="mx-auto w-full max-w-5xl">{tab && TABS[tab]?.()}</div>}
    </ModulePage>
  );
}

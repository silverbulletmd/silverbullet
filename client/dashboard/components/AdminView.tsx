import { SectionNav } from "@silverbulletmd/silverbullet/ui";
import { ADMIN_SECTIONS, type AdminSection, dashboardUrl } from "../routes.ts";
import { useNavigate } from "../navigation.ts";
import { ServerSettingsView } from "./ServerSettingsView.tsx";
import { AuthenticationView } from "./AuthenticationView.tsx";

import { RuntimesView } from "./RuntimesView.tsx";

export function AdminView({
  section,
  onUnauthorized,
}: {
  section: AdminSection;
  onUnauthorized: () => void;
}) {
  const navigate = useNavigate();
  const sectionUrl = (key: string) => dashboardUrl(`/admin?section=${key}`);
  return (
    <main class="sb-space-settings">
      <header class="sb-settings-heading">
        <div>
          <h1>Admin</h1>
        </div>
      </header>
      <div class="sb-settings-layout sb-management-server-settings">
        <SectionNav
          horizontal
          label="Admin settings"
          active={section}
          items={Object.entries(ADMIN_SECTIONS).map(([id, label]) => ({
            id,
            label,
            href: sectionUrl(id),
          }))}
          onSelect={(id) => navigate(sectionUrl(id))}
        />
        <div class="sb-settings-content">
          {section === "server" ? (
            <ServerSettingsView onUnauthorized={onUnauthorized} />
          ) : section === "runtimes" ? (
            <RuntimesView onUnauthorized={onUnauthorized} />
          ) : (
            <AuthenticationView onUnauthorized={onUnauthorized} />
          )}
        </div>
      </div>
    </main>
  );
}

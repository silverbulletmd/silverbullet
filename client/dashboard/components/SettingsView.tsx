import { SETTINGS_SECTIONS, type SettingsSection } from "../routes.ts";
import { ApisView } from "./ApisView.tsx";
import { AuthenticationView } from "./AuthenticationView.tsx";
import { SearchSettings } from "./SearchSettings.tsx";
import { SectionedPage } from "./SectionedPage.tsx";
import { ServerSettingsView } from "./ServerSettingsView.tsx";

export function SettingsView({
  section,
  onUnauthorized,
}: {
  section: SettingsSection;
  onUnauthorized: () => void;
}) {
  return (
    <SectionedPage
      title="Settings"
      path="/settings"
      labels={SETTINGS_SECTIONS}
      section={section}
      panels={{
        server: () => <ServerSettingsView onUnauthorized={onUnauthorized} />,
        authentication: () => (
          <AuthenticationView onUnauthorized={onUnauthorized} />
        ),
        search: () => <SearchSettings onUnauthorized={onUnauthorized} />,
        apis: () => <ApisView onUnauthorized={onUnauthorized} />,
      }}
    />
  );
}

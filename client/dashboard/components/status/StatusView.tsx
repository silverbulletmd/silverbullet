import { STATUS_SECTIONS, type StatusSection } from "../../routes.ts";
import { ConnectedApps } from "../ConnectedApps.tsx";
import { SectionedPage } from "../SectionedPage.tsx";
import { RuntimesStatus } from "./RuntimesStatus.tsx";
import { SearchStatus } from "./SearchStatus.tsx";
import { SyncStatus } from "./SyncStatus.tsx";

export function StatusView({
  section,
  onUnauthorized,
}: {
  section: StatusSection;
  onUnauthorized: () => void;
}) {
  return (
    <SectionedPage
      title="Status"
      path="/status"
      labels={STATUS_SECTIONS}
      section={section}
      panels={{
        runtimes: () => <RuntimesStatus onUnauthorized={onUnauthorized} />,
        apps: () => (
          <ConnectedApps mode="admin" onUnauthorized={onUnauthorized} />
        ),
        search: () => <SearchStatus onUnauthorized={onUnauthorized} />,
        sync: () => <SyncStatus onUnauthorized={onUnauthorized} />,
      }}
    />
  );
}

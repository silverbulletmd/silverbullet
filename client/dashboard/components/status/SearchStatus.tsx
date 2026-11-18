import {
  Alert,
  SearchSpacesTable,
  SearchSummary,
  useSearchOverview,
} from "@silverbulletmd/silverbullet/ui";
import {
  apiErrorText,
  getSearchOverview,
  rebuildSpaceSearch,
} from "../../api.ts";
import { dashboardUrl } from "../../routes.ts";

/** Status → Search: every space's search indexes, with Rebuild. */
export function SearchStatus({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const { overview, error, rebuilding, rebuild } = useSearchOverview({
    get: getSearchOverview,
    rebuild: async (id) => {
      await rebuildSpaceSearch(id);
    },
    errorText: (cause) => apiErrorText(cause, onUnauthorized),
  });

  return (
    <div class="sb-search-settings">
      {error && <Alert variant="error">{error}</Alert>}
      {!overview && !error && <p>Loading…</p>}
      {overview && (
        <>
          {overview.model === null && (
            <p class="sb-help-text">
              No search model is chosen. Choose one in{" "}
              <a href={dashboardUrl("/settings?section=search")}>
                Settings → Search
              </a>
              .
            </p>
          )}
          <SearchSummary spaces={overview.spaces} />
          <SearchSpacesTable
            spaces={overview.spaces}
            rebuilding={rebuilding}
            onRebuild={(id) => void rebuild(id)}
          />
        </>
      )}
    </div>
  );
}

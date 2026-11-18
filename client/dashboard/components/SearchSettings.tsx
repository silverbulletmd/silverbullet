import type { SearchOverview } from "@silverbulletmd/silverbullet/type/search_admin";
import {
  Alert,
  modelActive,
  modelChangeConfirmText,
  SearchModelPicker,
  useSearchModel,
} from "@silverbulletmd/silverbullet/ui";
import {
  apiErrorText,
  getSearchOverview,
  removeSearchModel,
  setSearchModel,
} from "../api.ts";
import { dashboardUrl } from "../routes.ts";

/**
 * Settings → Search: the search model (choose, download, remove stored ones).
 * Each space's index progress is under Status → Search.
 */
export function SearchSettings({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const model = useSearchModel<SearchOverview>({
    get: getSearchOverview,
    set: setSearchModel,
    remove: async (id) => {
      await removeSearchModel(id);
      return getSearchOverview();
    },
    // Every space that doesn't opt out follows the server's model.
    changeQuestion: (overview, from, to) =>
      modelChangeConfirmText(
        from,
        to,
        Object.values(overview.spaces).filter((s) => s.semanticChoice !== false)
          .length,
      ),
    storedWhere: "the server",
    errorText: (cause) => apiErrorText(cause, onUnauthorized),
    active: modelActive,
  });
  const overview = model.state;

  return (
    <div class="sb-search-settings">
      {model.error && <Alert variant="error">{model.error}</Alert>}
      {!overview && !model.error && <p>Loading…</p>}
      {overview && (
        <>
          <SearchModelPicker
            model={overview}
            busy={model.busy}
            onSelect={(id) => void model.select(id)}
            onRemove={(id) => void model.remove(id)}
          />
          <p class="sb-help-text">
            Index progress for each space is on{" "}
            <a href={dashboardUrl("/status?section=search")}>Status → Search</a>
            .
          </p>
        </>
      )}
    </div>
  );
}

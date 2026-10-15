import type { SearchOverview } from "@silverbulletmd/silverbullet/type/search_admin";
import {
  Alert,
  modelChangeConfirmText,
  overviewActive,
  rebuildConfirmText,
  SearchModelPicker,
  SearchSpacesTable,
  SearchSummary,
  useConfirmedAction,
  useSearchModel,
} from "@silverbulletmd/silverbullet/ui";
import { useState } from "preact/hooks";
import {
  apiErrorText,
  getSearchOverview,
  rebuildSpaceSearch,
  removeSearchModel,
  setSearchModel,
} from "../api.ts";

/**
 * Admin → Search: the search model (choose, download,
 * remove stored ones) and every space's search indexes with Rebuild. The
 * overview holds both, so the model's state polls while a space's index
 * changes too.
 */
export function SearchSettings({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const errorText = (cause: unknown) => apiErrorText(cause, onUnauthorized);
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
    errorText,
    active: overviewActive,
  });
  const overview = model.state;
  const [rebuildError, setRebuildError] = useState("");
  const rebuilds = useConfirmedAction({
    question: (id) => (overview?.spaces[id] ? rebuildConfirmText() : null),
    run: async (id) => {
      setRebuildError("");
      try {
        await rebuildSpaceSearch(id);
      } finally {
        await model.reload();
      }
    },
    onError: (cause) => {
      const message = errorText(cause);
      if (message !== null) setRebuildError(message);
    },
  });

  const error = rebuildError || model.error;
  return (
    <div class="sb-search-settings">
      {error && <Alert variant="error">{error}</Alert>}
      {!overview && !error && <p>Loading…</p>}
      {overview && (
        <>
          <SearchModelPicker
            model={overview}
            busy={model.busy}
            onSelect={(id) => void model.select(id)}
            onRemove={(id) => void model.remove(id)}
          />
          <h3>Spaces</h3>
          <SearchSummary spaces={overview.spaces} />
          <SearchSpacesTable
            spaces={overview.spaces}
            rebuilding={rebuilds.running}
            onRebuild={(id) => void rebuilds.start(id)}
          />
        </>
      )}
    </div>
  );
}

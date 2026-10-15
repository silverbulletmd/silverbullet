import type {
  CatalogModel,
  SemanticChoice,
} from "@silverbulletmd/silverbullet/type/search_admin";
import {
  onByDefaultText,
  SpaceSearchSettings,
} from "@silverbulletmd/silverbullet/ui";
import { apiErrorText, getSpaceSearch, rebuildSpaceSearch } from "../api.ts";

/** While nothing builds, a space's search info refreshes this often. */
const IDLE_POLL_MS = 30_000;

const NO_MODEL =
  "Choose a search model in Admin → Search to turn on semantic search.";

/**
 * A space's Search settings in Server's words: the "Semantic search" box
 * and, for a saved space on screen, its search indexes with Rebuild.
 * Reloads once `saved` (the stored choice) changes.
 */
export function SpaceSearchSection({
  spaceId,
  shown,
  model,
  saved,
  value,
  onChange,
  onUnauthorized,
}: {
  /** Absent for a new space. */
  spaceId?: string;
  /** Whether the section is on screen: only then is the space's info loaded. */
  shown: boolean;
  /** The server's search model, for the box's wording. */
  model: Pick<CatalogModel, "displayName"> | null;
  saved: SemanticChoice;
  value: SemanticChoice;
  onChange: (choice: SemanticChoice) => void;
  onUnauthorized: () => void;
}) {
  const onByDefault = onByDefaultText(model?.displayName ?? "", "this server");
  return (
    <SpaceSearchSettings
      host={{
        get: () => getSpaceSearch(spaceId!),
        rebuild: () => rebuildSpaceSearch(spaceId!),
        errorText: (cause) => apiErrorText(cause, onUnauthorized),
      }}
      options={{
        deps: [spaceId, saved],
        enabled: !!spaceId && shown,
        idlePollMs: IDLE_POLL_MS,
      }}
      saved={saved}
      value={value}
      onChange={onChange}
      copy={{
        noModel: NO_MODEL,
        default: onByDefault,
        loading: model ? onByDefault : NO_MODEL,
        heading: "Search indexes",
        unavailable: "Search isn't available for this space.",
      }}
    />
  );
}

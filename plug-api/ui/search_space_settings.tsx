import type { SemanticChoice, SpaceSearchInfo } from "../types/search_admin.ts";
import { Alert } from "./alert.tsx";
import { Button } from "./button.tsx";
import { CheckboxField } from "./field.tsx";
import { canRebuild, semanticToggle } from "./search_admin_model.ts";
import {
  type SpaceSearchHost,
  type SpaceSearchOptions,
  useSpaceSearch,
} from "./search_admin_state.ts";
import { SearchIndexStatus } from "./search_index_status.tsx";

/** A host's wording for a space's search settings. */
export type SpaceSearchCopy = {
  /** The box's help without a search model. */
  noModel: string;
  /** Its help with one, when the server has no note or warning. */
  default: string;
  /** Its help until the space's search info arrives; none when absent. */
  loading?: string;
  /** Above the indexes, when the host titles them. */
  heading?: string;
  /** Instead of the indexes for a space without any. */
  unavailable: string;
};

export type SpaceSearchSettingsViewProps<T extends SpaceSearchInfo> = {
  info: T | undefined;
  error: string;
  /** False shows the box only (a space not saved yet). */
  showIndexes: boolean;
  rebuilding: boolean;
  onRebuild: () => void;
  /** The stored choice and the edited one. */
  saved: SemanticChoice;
  value: SemanticChoice;
  onChange: (choice: SemanticChoice) => void;
  copy: SpaceSearchCopy;
  /**
   * A line shown instead of the indexes, with Rebuild still offered (e.g. a
   * closed space's); null: the indexes.
   */
  note?: (info: T) => string | null;
};

/** The "Semantic search" box and the space's indexes with Rebuild. */
export function SpaceSearchSettingsView<T extends SpaceSearchInfo>({
  info,
  error,
  showIndexes,
  rebuilding,
  onRebuild,
  saved,
  value,
  onChange,
  copy,
  note,
}: SpaceSearchSettingsViewProps<T>) {
  const toggle = semanticToggle({ saved, value, info });
  const help =
    toggle.help === "offByDefault"
      ? info?.offer.offByDefault
      : toggle.help === "warning"
        ? info?.offer.warning
        : copy[toggle.help];
  const noted = info && note ? note(info) : null;
  const rebuild = (enabled: boolean) => (
    <div class="row">
      <Button
        type="button"
        disabled={rebuilding || !enabled}
        onClick={onRebuild}
      >
        Rebuild search index
      </Button>
    </div>
  );
  return (
    <>
      <CheckboxField
        label="Semantic search"
        hint={help || undefined}
        checked={toggle.checked}
        disabled={toggle.disabled}
        onChange={(e) => onChange(toggle.choose(e.currentTarget.checked))}
      />
      {showIndexes && (
        <>
          {copy.heading && <h3>{copy.heading}</h3>}
          <div class="sb-space-search">
            {error && <Alert variant="error">{error}</Alert>}
            {!info && !error && <p>Loading…</p>}
            {noted !== null && (
              <>
                <p class="sb-help-text">{noted}</p>
                {rebuild(true)}
              </>
            )}
            {info && noted === null && info.indexes.length === 0 && (
              <p class="sb-help-text">{copy.unavailable}</p>
            )}
            {info && noted === null && info.indexes.length > 0 && (
              <>
                <SearchIndexStatus indexes={info.indexes} />
                {rebuild(canRebuild(info.indexes))}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

export type SpaceSearchSettingsProps<T extends SpaceSearchInfo> = Omit<
  SpaceSearchSettingsViewProps<T>,
  "info" | "error" | "showIndexes" | "rebuilding" | "onRebuild"
> & {
  host: SpaceSearchHost<T>;
  /** `enabled: false` also leaves out the indexes. */
  options: SpaceSearchOptions;
};

/**
 * A space's search settings, shared by Server's and Desktop's dashboards:
 * each host passes its adapter and wording. The parent owns the edited
 * choice and submits it when it differs from the saved one.
 */
export function SpaceSearchSettings<T extends SpaceSearchInfo>({
  host,
  options,
  ...view
}: SpaceSearchSettingsProps<T>) {
  const search = useSpaceSearch(host, options);
  return (
    <SpaceSearchSettingsView
      {...view}
      info={search.info}
      error={search.error}
      showIndexes={options.enabled ?? true}
      rebuilding={search.rebuilding}
      onRebuild={() => void search.rebuild()}
    />
  );
}

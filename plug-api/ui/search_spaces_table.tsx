import type { IndexKind, SpaceSearchSummary } from "../types/search_admin.ts";
import { Progress } from "./progress.tsx";
import { RowMenu } from "./row_menu.tsx";
import {
  CLOSED_SPACE_WORD,
  closedSpacesText,
  formatBytes,
  formatCount,
  INDEX_OFF_WORD,
  indexBuildCount,
  indexesBytes,
  indexProgress,
  indexStateText,
  indexStatusWord,
  searchSummaryText,
  semanticStateText,
} from "./search_admin_format.ts";
import { canRebuild, indexPhase, spaceRowRank } from "./search_admin_model.ts";

export type SearchSpacesTableProps<
  T extends SpaceSearchSummary = SpaceSearchSummary,
> = {
  /** Keyed by space id. */
  spaces: Record<string, T>;
  /** Spaces whose rebuild the host is starting. */
  rebuilding?: Record<string, boolean>;
  onRebuild: (id: string) => void;
  /**
   * Whether a space is closed, so has no indexes to show: its row says
   * "Closed", with Rebuild still offered. None by default.
   */
  closed?: (space: T) => boolean;
};

export type SearchSummaryProps = {
  /** Keyed by space id. */
  spaces: Record<string, Pick<SpaceSearchSummary, "name" | "indexes">>;
};

/**
 * What search is doing across the spaces, in one line above their table
 * (`searchSummaryText`); nothing when no space has an index.
 */
export function SearchSummary({ spaces }: SearchSummaryProps) {
  const text = searchSummaryText(spaces);
  return text === null ? null : (
    <p class="sb-search-summary" role="status">
      {text}
    </p>
  );
}

/**
 * An index's status in one word, its details in the tooltip; while it
 * builds, a small bar and its pages done.
 */
function IndexCell({
  space,
  kind,
}: {
  space: SpaceSearchSummary;
  kind: IndexKind;
}) {
  const report = space.indexes.find((r) => r.kind === kind);
  if (!report) {
    const off = kind === "semantic" ? semanticStateText(space.semantic) : null;
    return (
      <td data-kind={kind}>
        <span
          class="sb-search-spaces-status sb-search-spaces-muted"
          title={off ?? undefined}
        >
          {off === null ? "—" : INDEX_OFF_WORD}
        </span>
      </td>
    );
  }
  const count = indexBuildCount(report);
  const progress = indexProgress(report);
  return (
    <td data-kind={kind}>
      <span
        class="sb-search-spaces-status"
        data-phase={indexPhase(report)}
        title={indexStateText(report)}
      >
        {indexStatusWord(report)}
        {count !== null && progress !== null && (
          <>
            <Progress value={progress} />
            <span class="sb-search-spaces-count">{count}</span>
          </>
        )}
      </span>
    </td>
  );
}

/**
 * Every space's search indexes, one row per space: active spaces first,
 * then the other open ones, then the closed ones, each by name. A row's ⋯
 * menu offers Rebuild (disabled while it has nothing to rebuild:
 * `canRebuild`, unless the space is closed). Never fetches or confirms; the
 * host does.
 */
export function SearchSpacesTable<T extends SpaceSearchSummary>({
  spaces,
  rebuilding,
  onRebuild,
  closed,
}: SearchSpacesTableProps<T>) {
  const rows = Object.entries(spaces).map(([id, space]) => {
    const isClosed = closed ? closed(space) : false;
    return {
      id,
      space,
      isClosed,
      rank: spaceRowRank(space.indexes, isClosed),
    };
  });
  rows.sort(
    (a, b) => a.rank - b.rank || a.space.name.localeCompare(b.space.name),
  );
  return (
    <>
      <div class="sb-search-spaces-scroll">
        <table class="sb-search-spaces">
          <thead>
            <tr>
              <th>Space</th>
              <th class="sb-search-spaces-number">Pages</th>
              <th>Full text</th>
              <th>Semantic search</th>
              <th class="sb-search-spaces-number">Size</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, space, isClosed }) => {
              const bytes = indexesBytes(space.indexes);
              return (
                <tr key={id}>
                  <td class="sb-search-spaces-name" title={space.name}>
                    {space.name}
                  </td>
                  <td class="sb-search-spaces-number">
                    {space.pages === null ? "—" : formatCount(space.pages)}
                  </td>
                  {isClosed ? (
                    <td colSpan={2} class="sb-search-spaces-muted">
                      {CLOSED_SPACE_WORD}
                    </td>
                  ) : (
                    <>
                      <IndexCell space={space} kind="fullText" />
                      <IndexCell space={space} kind="semantic" />
                    </>
                  )}
                  <td class="sb-search-spaces-number">
                    {bytes === null ? "—" : formatBytes(bytes)}
                  </td>
                  <td class="sb-search-spaces-actions">
                    <RowMenu
                      label={`Actions for ${space.name}`}
                      items={[
                        {
                          label: "Rebuild",
                          disabled:
                            !!rebuilding?.[id] ||
                            (!isClosed && !canRebuild(space.indexes)),
                          run: () => onRebuild(id),
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.isClosed) && (
        <p class="sb-search-spaces-footnote">{closedSpacesText()}</p>
      )}
    </>
  );
}

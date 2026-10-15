/**
 * The search admin's rules, apart from its wording: what an index's state
 * means for the badge, polling and Rebuild, and how the "Semantic search"
 * box is offered. Pure functions.
 */
import type {
  IndexReport,
  SearchModelState,
  SearchOverview,
  SemanticChoice,
  SpaceSearchInfo,
} from "../types/search_admin.ts";

/** While a download or a build runs, the state refreshes this often. */
export const BUSY_POLL_MS = 2000;

/**
 * What an index is doing: `preparing` (starting, or downloading the model)
 * and `building` (building, or waiting to) badge a space as indexing;
 * `catchingUp` answers while it reconciles many changes.
 */
export type IndexPhase =
  | "ready"
  | "catchingUp"
  | "preparing"
  | "building"
  | "failed";

export function indexPhase(r: IndexReport): IndexPhase {
  switch (r.state) {
    case "starting":
    case "downloading":
      return "preparing";
    case "waiting":
    case "building":
      return "building";
    case "ready":
      return r.catchUp ? "catchingUp" : "ready";
    case "failed":
      return "failed";
  }
}

function anyIn(indexes: IndexReport[], phases: IndexPhase[]): boolean {
  return indexes.some((r) => phases.includes(indexPhase(r)));
}

/** A space's badge in lists: the worst phase of its indexes. */
export type SpaceSearchBadge = "building" | "failed" | null;

export function spaceBadge(indexes: IndexReport[]): SpaceSearchBadge {
  if (anyIn(indexes, ["failed"])) return "failed";
  if (anyIn(indexes, ["preparing", "building"])) return "building";
  return null;
}

/** Whether any index changes, so its status is worth polling. */
export function indexesBusy(indexes: IndexReport[]): boolean {
  return anyIn(indexes, ["preparing", "building", "catchingUp"]);
}

/**
 * Whether a rebuild has something to do: the space has indexes and none
 * builds or waits to.
 */
export function canRebuild(indexes: IndexReport[]): boolean {
  return indexes.length > 0 && !anyIn(indexes, ["building"]);
}

/**
 * Where a space sorts in the spaces table: active spaces first (an index
 * building, waiting, catching up or failed), then the other open ones, then
 * the `closed` ones.
 */
export function spaceRowRank(indexes: IndexReport[], closed: boolean): number {
  if (closed) return 2;
  return indexes.some((r) => indexPhase(r) !== "ready") ? 0 : 1;
}

/**
 * Whether the model downloads. A chosen model still `missing` counts: its
 * download is about to start.
 */
export function modelActive(m: SearchModelState): boolean {
  const download = m.download?.state;
  return (
    download === "downloading" || (m.model !== null && download === "missing")
  );
}

/** Whether the overview shows a download or an index changing. */
export function overviewActive(overview: SearchOverview): boolean {
  return (
    modelActive(overview) ||
    Object.values(overview.spaces).some((s) => indexesBusy(s.indexes))
  );
}

/** How often to poll `overview`: busy, else not at all. */
export function overviewPollMs(
  overview: SearchOverview | undefined,
): number | null {
  return overview && overviewActive(overview) ? BUSY_POLL_MS : null;
}

/**
 * Which help the "Semantic search" box shows: the host's wording while
 * loading, without a model and by default, the server's `offer` text when
 * the space is off by default for its size or warns.
 */
export type SemanticHelp =
  | "loading"
  | "noModel"
  | "offByDefault"
  | "warning"
  | "default";

export type SemanticToggle = {
  checked: boolean;
  disabled: boolean;
  help: SemanticHelp;
  /** The choice to store once the box is set to `checked`. */
  choose: (checked: boolean) => SemanticChoice;
};

/**
 * How the "Semantic search" box is offered for a space whose stored
 * choice is `saved` and edited one `value`, given its search `info`.
 *
 * Until info describing `saved` arrives (none yet, or one from before a
 * save) the box shows the saved choice and stays disabled. Then it is
 * checked when the space runs semantic search as saved, or as edited.
 * Without a model the model help comes first (the size is moot then) and
 * an unchecked box stays off; a checked one can still be unchecked. A space
 * off by default for its size shows the server's note, checked or not.
 * Unchecking stores false (opted out), checking null (follow the default)
 * or, when the default is off for its size, true; returning to the saved
 * state stores the saved choice.
 */
export function semanticToggle({
  saved,
  value,
  info,
}: {
  saved: SemanticChoice;
  value: SemanticChoice;
  info:
    | Pick<SpaceSearchInfo, "semanticChoice" | "semantic" | "offer">
    | undefined;
}): SemanticToggle {
  const current = info?.semanticChoice === saved ? info : undefined;
  const savedOn = current ? current.semantic === "on" : saved !== false;
  const checked = value === saved ? savedOn : value !== false;
  const offByDefault = current?.offer.offByDefault != null;
  const choose = (next: boolean): SemanticChoice =>
    next === savedOn ? saved : next ? (offByDefault ? true : null) : false;
  const offered = (help: SemanticHelp, disabled: boolean) => ({
    checked,
    disabled,
    help,
    choose,
  });
  if (!current) return offered("loading", true);
  if (current.semantic === "noModel") return offered("noModel", !checked);
  if (offByDefault) return offered("offByDefault", false);
  if (current.offer.warning) return offered("warning", false);
  return offered("default", false);
}

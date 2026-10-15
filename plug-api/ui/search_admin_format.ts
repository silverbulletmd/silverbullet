/**
 * Copy for the search admin components (model picker, index status, spaces
 * table) and for their hosts' confirmations: strings only. The rules behind
 * them live in `search_admin_model.ts`.
 */
import type {
  CatalogModel,
  IndexKind,
  IndexReport,
  ModelDownload,
  SemanticSpaceState,
  SpaceSearchSummary,
  StoredModel,
} from "../types/search_admin.ts";
import { indexPhase, type SpaceSearchBadge } from "./search_admin_model.ts";

/** Bytes in decimal units, like the server's log lines: "488 MB", "3.1 MB", "820 kB". */
export function formatBytes(n: number): string {
  const units = ["kB", "MB", "GB", "TB"];
  if (n < 1000) return `${Math.round(n)} B`;
  let value = n / 1000;
  let unit = 0;
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const shown =
    value < 9.95
      ? String(Math.round(value * 10) / 10)
      : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}

/** Bytes rounded to two significant digits, for estimates: "590 MB". */
export function formatAboutBytes(n: number): string {
  if (n <= 0) return formatBytes(0);
  const magnitude = 10 ** (Math.floor(Math.log10(n)) - 1);
  return formatBytes(Math.round(n / magnitude) * magnitude);
}

/** "2,950". */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function pagesText(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "page" : "pages"}`;
}

function plural(n: number, word: string): string {
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}

export function indexTitle(kind: IndexKind): string {
  return kind === "fullText" ? "Full-text index" : "Semantic index";
}

/** One line for an index's state: "Ready · 2,950 pages · 41 MB". */
export function indexStateText(r: IndexReport): string {
  switch (r.state) {
    case "starting":
      return "Starting…";
    case "waiting":
      return "Waiting to build";
    case "downloading":
      return `Downloading the model · ${formatBytes(r.done)} of ${formatBytes(r.total)}`;
    case "building":
      return `Building · ${formatCount(r.done)} of ${pagesText(r.total)}`;
    case "failed":
      return `Failed: ${r.reason}`;
    case "ready": {
      if (r.catchUp) {
        return `Ready · catching up ${formatCount(r.catchUp.done)} of ${pagesText(r.catchUp.total)}`;
      }
      const parts = ["Ready"];
      if (r.pages !== null) parts.push(pagesText(r.pages));
      if (r.bytes !== null) parts.push(formatBytes(r.bytes));
      return parts.join(" · ");
    }
  }
}

/**
 * An index's status in the spaces table, in one word: "Ready", "Building",
 * "Waiting" (its turn, starting, or the model downloading), "Catching up"
 * or "Failed". `indexStateText` gives the details.
 */
export function indexStatusWord(r: IndexReport): string {
  switch (indexPhase(r)) {
    case "ready":
      return "Ready";
    case "catchingUp":
      return "Catching up";
    case "preparing":
      return "Waiting";
    case "building":
      return r.state === "building" ? "Building" : "Waiting";
    case "failed":
      return "Failed";
  }
}

/** A building index's pages done, next to its bar: "115/392"; else null. */
export function indexBuildCount(r: IndexReport): string | null {
  return r.state === "building"
    ? `${formatCount(r.done)}/${formatCount(r.total)}`
    : null;
}

/** The spaces table's status for a space without an index of a kind. */
export const INDEX_OFF_WORD = "Off";

/** The spaces table's status for a closed space, and the line under it. */
export const CLOSED_SPACE_WORD = "Closed";
export function closedSpacesText(): string {
  return "Closed spaces show their status when opened.";
}

function fraction(done: number, total: number): number {
  return total > 0 ? Math.min(1, done / total) : 0;
}

/** 0..1 while building, downloading or catching up; else null. */
export function indexProgress(r: IndexReport): number | null {
  switch (r.state) {
    case "building":
    case "downloading":
      return fraction(r.done, r.total);
    case "ready":
      return r.catchUp ? fraction(r.catchUp.done, r.catchUp.total) : null;
    default:
      return null;
  }
}

/** 0..1 of a model download. */
export function downloadProgress(
  d: Extract<ModelDownload, { state: "downloading" }>,
): number {
  return fraction(d.done, d.total);
}

/** The indexes' bytes on disk together; null when none reports any. */
export function indexesBytes(indexes: IndexReport[]): number | null {
  const sizes = indexes
    .map((r) => r.bytes)
    .filter((b): b is number => b !== null);
  return sizes.length ? sizes.reduce((a, b) => a + b, 0) : null;
}

type Progressed = { done: number; total: number };

/** The report of `indexes` furthest from done among those `progress` measures. */
function slowest(
  indexes: IndexReport[],
  progress: (r: IndexReport) => Progressed | null,
): Progressed | null {
  let found: Progressed | null = null;
  for (const r of indexes) {
    const p = progress(r);
    if (
      p &&
      (!found || fraction(p.done, p.total) < fraction(found.done, found.total))
    ) {
      found = p;
    }
  }
  return found;
}

/**
 * One line above the spaces table saying what search is doing: "Indexing
 * Notes (1,200 of 5,000 pages), 2 spaces waiting", or "All indexes up to
 * date"; null when no space has an index to report on (on Desktop, every
 * space closed). Each space counts once, by what it is doing (building,
 * waiting for the model, waiting its turn, starting, catching up), and
 * again when one of its indexes failed.
 */
export function searchSummaryText(
  spaces: Record<string, Pick<SpaceSearchSummary, "name" | "indexes">>,
): string | null {
  const rows = Object.values(spaces).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (!rows.some((s) => s.indexes.length > 0)) return null;
  const indexing: string[] = [];
  const catchingUp: string[] = [];
  const failed: string[] = [];
  let download: Progressed | null = null;
  let waiting = 0;
  let starting = 0;
  for (const { name, indexes } of rows) {
    const has = (state: IndexReport["state"]) =>
      indexes.some((r) => r.state === state);
    const building = slowest(indexes, (r) =>
      r.state === "building" ? r : null,
    );
    const downloading = indexes.find((r) => r.state === "downloading");
    const catchUp = slowest(indexes, (r) =>
      r.state === "ready" ? r.catchUp : null,
    );
    if (building) {
      indexing.push(
        `Indexing ${name} (${formatCount(building.done)} of ${pagesText(building.total)})`,
      );
    } else if (downloading?.state === "downloading") {
      download ??= downloading;
    } else if (has("waiting")) {
      waiting++;
    } else if (has("starting")) {
      starting++;
    } else if (catchUp) {
      catchingUp.push(
        `Catching up ${name} (${formatCount(catchUp.done)} of ${pagesText(catchUp.total)})`,
      );
    }
    if (has("failed")) failed.push(name);
  }
  const parts = [...indexing];
  if (download) {
    parts.push(
      `Downloading the search model (${formatBytes(download.done)} of ${formatBytes(download.total)})`,
    );
  }
  if (waiting) parts.push(`${plural(waiting, "space")} waiting`);
  if (starting) parts.push(`${plural(starting, "space")} starting`);
  parts.push(...catchingUp);
  if (failed.length === 1) parts.push(`Search failed in ${failed[0]}`);
  if (failed.length > 1) {
    parts.push(`Search failed in ${plural(failed.length, "space")}`);
  }
  // One sentence: later parts start in lower case ("…, catching up Journal").
  return parts.length
    ? parts
        .map((part, i) => (i ? part[0].toLowerCase() + part.slice(1) : part))
        .join(", ")
    : "All indexes up to date";
}

/** The space list's badge for a space's search indexes. */
export function spaceBadgeLabel(badge: SpaceSearchBadge): string | null {
  switch (badge) {
    case "building":
      return "Indexing";
    case "failed":
      return "Search failed";
    default:
      return null;
  }
}

/**
 * The "Semantic search" box's help for a space that follows the default,
 * naming the model in use and `where` it is chosen ("this server").
 */
export function onByDefaultText(modelName: string, where: string): string {
  return `On by default for ${where}'s search model (${modelName}). Turn it off to use full-text search only in this space.`;
}

/** Why a space has no semantic search; null when it has. */
export function semanticStateText(s: SemanticSpaceState): string | null {
  switch (s) {
    case "on":
      return null;
    case "offByChoice":
      return "Off by choice";
    case "offTooLarge":
      return "Off: over 5,000 pages";
    case "noModel":
      return "Off: no search model";
  }
}

/** The confirmation before rebuilding a space's search indexes. */
export function rebuildConfirmText(): string {
  return "Are you sure you want to rebuild the search index?";
}

/**
 * The confirmation before changing the search model from `from` to `to`
 * (null: none), given how many spaces use semantic search
 * (`semanticSpaces`); null when nothing needs confirming.
 */
export function modelChangeConfirmText(
  from: CatalogModel | null,
  to: CatalogModel | null,
  semanticSpaces: number,
): string | null {
  if (semanticSpaces <= 0 || from?.id === to?.id) return null;
  const spaces = plural(semanticSpaces, "space");
  if (to === null) {
    return `Turn off semantic search for ${spaces}?`;
  }
  const download = `${to.displayName} (${formatBytes(to.downloadBytes)})`;
  if (from === null) {
    return `Turn on semantic search? This downloads ${download} and indexes ${spaces} in the background.`;
  }
  return `Switch to ${download}? ${spaces} will be re-indexed in the background.`;
}

/** The confirmation before removing a stored model from `where` ("the server"). */
export function removeModelConfirmText(
  stored: StoredModel,
  where: string,
): string {
  return `Remove ${stored.displayName} (${formatBytes(stored.bytes)}) from ${where}? You can download it again later.`;
}

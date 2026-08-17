import { useMemo, useRef } from "preact/hooks";
import type { RankedRow } from "../engine.ts";
import { type RankCacheEntry, rankIncrementally } from "../incremental_rank.ts";
import { applySegment } from "../segments.ts";
import { type ActiveView, engine } from "../panel.ts";
import { matchesTags, splitHashtags } from "../phrase.ts";
import {
  computeTreeDisplay,
  type TreeDisplay,
  type TreeNode,
  type VisibleRow,
} from "../../../../plug-api/ui/tree_model.ts";
import type { SegmentMeta } from "../types.ts";

/** Rendered rows when the view doesn't set `presentation.limit`. */
const DEFAULT_LIMIT = 200;

// Sentinel `selectedPath` for the tree's create row -- it lives outside the
// tree, so it has no node path of its own, and a NUL byte can't collide with
// a real object name.
export const CREATE_PATH = "\u0000create";

// Drag-and-drop is desktop-only: HTML5 drag events don't fire
// on touch at all, so a `draggable` row there only breaks scrolling. Queried
// once -- the panel's iframe doesn't survive a device change anyway.
const POINTER_FINE =
  globalThis.matchMedia?.("(pointer: fine)").matches ?? false;

/**
 * Everything the panel shows, and everything its keys and commands act on,
 * derived from the active view and the four pieces of input state (phrase,
 * segment, selection, expansion). Pure, and memoized per input rather than
 * per render: at 5000 rows this is the keystroke's whole cost.
 */
export type DerivedView = {
  sourceMode: boolean;
  segments?: SegmentMeta[];
  /** The phrase ranking runs on: no hashtags, no `stripPrefix` sigil. */
  rankPhrase: string;
  trimmedPhrase: string;
  visible: RankedRow[];
  /** `visible` with the create slot spliced in, as the list actually renders. */
  listItems: (RankedRow | undefined)[];
  /** The ranked row at a list index; undefined when that index is the create row. */
  rowAtIndex: (index: number) => RankedRow | undefined;
  canCreate: boolean;
  createIndex: number;
  createSelected: boolean;
  createSelectedInTree: boolean;
  activeIndex: number;
  lastIndex: number;
  error?: string;
  fatalError: boolean;
  segmentUnavailable: boolean;
  isTreeMode: boolean;
  treeFiltering: boolean;
  truncated: number;
  canDrag: boolean;
  treeDisplay?: TreeDisplay;
  treeVisible: VisibleRow[];
  treeLastIndex: number;
  activeTreeIndex: number;
  activeTreeNode?: TreeNode;
};

export function useDerived({
  view,
  bootError,
  phrase,
  segmentIndex,
  selectedIndex,
  selectedPath,
  expanded,
  readOnly,
}: {
  view?: ActiveView;
  bootError?: string;
  phrase: string;
  segmentIndex: number;
  selectedIndex: number;
  selectedPath?: string;
  expanded: Set<string>;
  readOnly: boolean;
}): DerivedView {
  // Source mode: the source already answered this phrase and segment, in the
  // order it wants them shown -- ranking them again here would overrule it.
  const sourceMode = view?.meta.search === "source";

  // Hashtag pre-filtering: a `#tag` in the phrase is a filter, not something
  // to fuzzy-match a name against. Source mode is exempt -- its source is
  // handed the raw phrase and decides for itself what a `#` means.
  const hashtagFilter = !!view?.meta.hashtagFilter && !sourceMode;
  const { tags, rest: rankPhrase } = useMemo(() => {
    // A view whose rows are named without the sigil people reach for -- the
    // tag picker's rows are `work`, not `#work` -- drops it before ranking, so
    // typing it and not typing it both find the row.
    const strip = view?.meta.stripPrefix;
    const typed =
      strip && phrase.startsWith(strip) ? phrase.slice(strip.length) : phrase;
    return hashtagFilter ? splitHashtags(typed) : { tags: [], rest: typed };
  }, [hashtagFilter, phrase, view?.meta.stripPrefix]);
  // A stable stand-in for `tags`, whose array identity changes every
  // keystroke: an untagged phrase keeps this `""` from keystroke to keystroke,
  // so the row filtering below stays a per-segment memo rather than becoming
  // per-keystroke work for every view. NUL-joined, because a `#<tag like
  // this>` can itself contain spaces.
  const tagKey = tags.join("\u0000");

  // One pass over the batched `where` masks; free of syscalls, like the
  // phrase below, so switching segments costs no round trip. A source-mode
  // view subsets in its own source, off the label it was handed, so its rows
  // arrive already filtered -- and no masks are computed to filter them with.
  const filteredRows = useMemo(() => {
    if (!view) return [];
    if (sourceMode) return view.rows;
    const rows = applySegment(
      view.rows,
      segmentIndex,
      view.meta.segments,
      view.segmentMasks,
    );
    if (!tagKey) return rows;
    const wanted = tagKey.split("\u0000");
    return rows.filter((row) => matchesTags(row, wanted));
  }, [view, sourceMode, segmentIndex, tagKey]);

  const rankCacheRef = useRef<RankCacheEntry>();
  const ranked = useMemo(() => {
    if (!view) return [];
    if (sourceMode) return filteredRows.map((row) => ({ row, score: 0 }));
    const result = rankIncrementally(
      rankCacheRef.current,
      view,
      filteredRows,
      rankPhrase,
      (rows, phrase) => engine.rankRows(rows, phrase, view.meta),
    );
    rankCacheRef.current = result.next;
    return result.ranked;
  }, [view, sourceMode, filteredRows, rankPhrase]);

  const limit = view?.meta.limit || DEFAULT_LIMIT;
  // Everything past the cap stays out of the DOM: a phrase that matches
  // thousands of rows is a phrase that needs another character, not 5000 rows
  // of markup. See the footer row in the render.
  const visible = ranked.length > limit ? ranked.slice(0, limit) : ranked;

  const segments = view?.meta.segments;

  // The ranking phrase, not the raw one: a `#tag` in it is a filter, and a
  // page named after the filter you typed is not what "create this" means.
  // (FilterList makes the same choice -- its `allowNew` runs on the phrase its
  // `phrasePreprocessor` already stripped.)
  const trimmedPhrase = rankPhrase.trim();
  // Same trigger as FilterList's `allowNew`: a non-empty phrase that no row
  // already carries verbatim. Scanning `view.rows` (not `ranked`) keeps this
  // honest when the fuzzy ranker drops an exact match off the visible list.
  const canCreate =
    !!view?.meta.hasCreate &&
    !readOnly &&
    trimmedPhrase.length > 0 &&
    !view.rows.some((r) => r.primary === trimmedPhrase);

  const lastIndex = visible.length - 1 + (canCreate ? 1 : 0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, lastIndex));
  /**
   * Where the create row sits among the list's rows: **second**, right under
   * the best match, which is where `FilterList` spliced it and what makes
   * one ArrowDown from the top mean "create it instead". With nothing
   * matching it is the only row there is, so it is first. (A tree keeps its
   * own pinned-below-the-tree placement -- see the render.)
   */
  const createIndex =
    !canCreate || view?.meta.mode === "tree"
      ? -1
      : visible.length === 0
        ? 0
        : 1;
  const rowAtIndex = (index: number) =>
    index === createIndex
      ? undefined
      : visible[createIndex >= 0 && index > createIndex ? index - 1 : index];
  const listItems = useMemo(() => {
    if (createIndex < 0) return visible;
    const out: (RankedRow | undefined)[] = [...visible];
    out.splice(createIndex, 0, undefined);
    return out;
  }, [visible, createIndex]);
  const error = bootError ?? view?.error;
  // An error with nothing left to show takes the panel; an error over rows
  // that are still good is a banner above them. In source mode the source
  // runs per keystroke, so one bad phrase must not clear the screen.
  const fatalError = !!error && ranked.length === 0;
  // The `where` masks never arrived (their batch failed), so this segment can
  // only fail closed -- which on its own looks exactly like "nothing matched".
  const segmentUnavailable =
    !sourceMode && !!segments?.[segmentIndex]?.hasWhere && !view?.segmentMasks;

  const isTreeMode = view?.meta.mode === "tree";
  const treeFiltering = isTreeMode && phrase.trim().length > 0;
  // An unfiltered tree is bounded by what's expanded, so it renders whole; a
  // filtered one auto-expands every match, which is what the cap is for.
  const truncated =
    !isTreeMode || treeFiltering ? ranked.length - visible.length : 0;
  // While filtering, the pruned tree isn't the real structure -- a "folder"
  // on screen may be missing most of its children -- so a drop into it would
  // mean something other than what the user sees.
  const canDrag =
    !!view?.meta.hasMove && !treeFiltering && POINTER_FINE && !readOnly;

  // Reuses `visible` (already ranked with the same fields config, already
  // capped) instead of calling `rankRows` a second time.
  const treeScores = useMemo(() => {
    if (!treeFiltering) return undefined;
    return new Map(visible.map((r) => [String(r.row.obj.name), r.score]));
  }, [treeFiltering, visible]);

  const expandAll = view?.meta.expandAll === true;
  const treeDisplay = useMemo(() => {
    if (!view || !isTreeMode) return undefined;
    // The filtered subset, not every row: the folders its rows hang off are
    // rebuilt from their names, so ancestors come back without pruning twice.
    return computeTreeDisplay(
      filteredRows,
      view.meta.hierarchy.separator,
      view.meta.foldersFirst,
      { expanded, expandAll },
      treeScores,
    );
  }, [view, isTreeMode, filteredRows, expanded, expandAll, treeScores]);

  const treeVisible = treeDisplay?.visible ?? [];
  // The create row is pinned one slot past the last tree row, so tree
  // keyboard nav walks straight onto it.
  const treeLastIndex = treeVisible.length - 1 + (canCreate ? 1 : 0);
  const treeIndex =
    canCreate && selectedPath === CREATE_PATH
      ? treeVisible.length
      : selectedPath
        ? treeVisible.findIndex((v) => v.node.path === selectedPath)
        : -1;
  const activeTreeIndex =
    treeIndex >= 0 ? treeIndex : treeLastIndex >= 0 ? 0 : -1;
  const activeTreeNode =
    activeTreeIndex >= 0 && activeTreeIndex < treeVisible.length
      ? treeVisible[activeTreeIndex].node
      : undefined;
  // Derived from the index rather than from the sentinel, so the fallback to
  // index 0 lands on the create row when the phrase pruned the tree to
  // nothing -- otherwise the only visible row would look actionable while
  // Enter did nothing.
  const createSelectedInTree =
    canCreate && activeTreeIndex >= 0 && activeTreeIndex >= treeVisible.length;
  const createSelected = isTreeMode
    ? createSelectedInTree
    : activeIndex === createIndex;

  return {
    sourceMode,
    segments,
    rankPhrase,
    trimmedPhrase,
    visible,
    listItems,
    rowAtIndex,
    canCreate,
    createIndex,
    createSelected,
    createSelectedInTree,
    activeIndex,
    lastIndex,
    error,
    fatalError,
    segmentUnavailable,
    isTreeMode,
    treeFiltering,
    truncated,
    canDrag,
    treeDisplay,
    treeVisible,
    treeLastIndex,
    activeTreeIndex,
    activeTreeNode,
  };
}

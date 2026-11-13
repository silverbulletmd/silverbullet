import { Language, syntaxTree } from "@codemirror/language";
import {
  Annotation,
  type EditorState,
  type Range,
  type StateEffectType,
  type Text,
  type Transaction,
} from "@codemirror/state";
import type { Decoration, DecorationSet } from "@codemirror/view";
import type { Tree } from "@lezer/common";

/**
 * Whole lines of the new document holding every top-level block an edit or
 * a cursor move touched. Only these decorations rebuild; the rest map.
 */
export type DirtyRegion = { from: number; to: number };

type Block = { from: number; to: number; name: string };

/**
 * Cache keys per occurrence: identical expressions on one page would share a
 * cached result, and a DOM element in it can only be shown once. The first
 * copy keeps the plain key; a decoration build numbers the rest in order.
 */
export class OccurrenceKeys {
  private seen = new Map<string, number>();

  key(base: string): string {
    const n = this.seen.get(base) ?? 0;
    this.seen.set(base, n + 1);
    return n === 0 ? base : `${base}:dup${n}`;
  }

  /** Count a key handed out by an earlier build (`base` or `base:dupN`) */
  seed(key: string): void {
    const dup = /^(.*):dup(\d+)$/s.exec(key);
    const base = dup ? dup[1] : key;
    const next = dup ? Number(dup[2]) + 1 : 1;
    this.seen.set(base, Math.max(this.seen.get(base) ?? 0, next));
  }
}

/** What a builder rebuilds when only part of the page changed */
export type DecorationRange = DirtyRegion & {
  /** Numbers repeated expressions after the ones before the range */
  keys: OccurrenceKeys;
};

export type IncrementalDecorations = {
  /**
   * Whether `from`–`to` holds syntax that affects decorations elsewhere on
   * the page. Asked of the old and the new source; either rebuilds it all.
   */
  pageWide?: (state: EditorState, from: number, to: number) => boolean;
  /** The builder numbers widgets with `OccurrenceKeys` */
  keyed?: boolean;
};

export type DecorationBuilder = (
  state: EditorState,
  tr?: Transaction,
  range?: DecorationRange,
) => DecorationSet;

// Rebuilding most of the page costs less in one pass than piecewise
const maxDirtyShare = 0.5;

const blockCache = new WeakMap<Tree, Block[]>();
const regionCache = new WeakMap<Transaction, DirtyRegion[] | null>();

/** The Document node's children, in order */
export function topLevelBlocks(tree: Tree): Block[] {
  let blocks = blockCache.get(tree);
  if (blocks) return blocks;
  blocks = [];
  const cursor = tree.cursor();
  if (cursor.firstChild()) {
    do blocks.push({ from: cursor.from, to: cursor.to, name: cursor.name });
    while (cursor.nextSibling());
  }
  blockCache.set(tree, blocks);
  return blocks;
}

/**
 * The lines from just after the block before `from`–`to` up to just before
 * the block after it. A block's decorations never start outside its lines,
 * so neighbors' decorations all fall outside the region.
 */
function expand(
  blocks: Block[],
  doc: Text,
  from: number,
  to: number,
): DirtyRegion {
  from = doc.lineAt(from).from;
  to = doc.lineAt(to).to;
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].to < from) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].from <= to) lo = mid + 1;
    else hi = mid;
  }
  const next = lo;
  return {
    from:
      first > 0 ? Math.min(doc.lineAt(blocks[first - 1].to).to + 1, from) : 0,
    to:
      next < blocks.length
        ? Math.max(doc.lineAt(blocks[next].from).from - 1, to)
        : doc.length,
  };
}

function merge(regions: DirtyRegion[]): DirtyRegion[] {
  regions.sort((a, b) => a.from - b.from);
  const out: DirtyRegion[] = [];
  for (const r of regions) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

function inRegions(regions: DirtyRegion[], from: number, to: number) {
  return regions.some((r) => from <= r.to && to >= r.from);
}

// Internal to @codemirror/language (missing from its typings): the effect
// the background parser extends the tree with
const parseProgress = (
  Language as unknown as { setState?: StateEffectType<unknown> }
).setState;

/**
 * Marks a transaction that only shows the parser got further, after work done
 * with `ensureSyntaxTree`. Unmarked, such an empty transaction would rebuild
 * all decorations, since `dispatch({})` is how other state asks for that.
 */
export const parsedFurther = Annotation.define<boolean>();

function computeDirtyRegions(tr: Transaction): DirtyRegion[] | null {
  // Other effects, reconfiguration and empty transactions (`dispatch({})`)
  // are how state outside the document asks for a refresh
  if (tr.reconfigured) return null;
  const parseOnly =
    tr.effects.length > 0
      ? !!parseProgress && tr.effects.every((e) => e.is(parseProgress))
      : !!tr.annotation(parsedFurther);
  if (tr.effects.length > 0 && !parseOnly) return null;
  const { startState, state } = tr;
  const oldTree = syntaxTree(startState);
  const newTree = syntaxTree(state);
  const oldComplete = oldTree.length >= startState.doc.length;
  const newComplete = newTree.length >= state.doc.length;
  if (!tr.docChanged && startState.selection.eq(state.selection)) {
    // Widgets put the selection back where it is after they render, to have
    // the view measure them again: nothing to rebuild
    if (tr.selection && !parseOnly && oldTree === newTree) return [];
    if (!parseOnly) return null;
    if (oldTree === newTree) return [];
    // A reparse that ends where the old one did may have changed anything
    if (oldComplete && newComplete) return null;
  }
  const oldBlocks = topLevelBlocks(oldTree);
  const newBlocks = topLevelBlocks(newTree);
  const regions: DirtyRegion[] = [];
  const addOld = (from: number, to: number) => {
    const r = expand(oldBlocks, startState.doc, from, to);
    regions.push({
      from: tr.changes.mapPos(r.from, -1),
      to: tr.changes.mapPos(r.to, 1),
    });
  };
  const addNew = (from: number, to: number) =>
    regions.push(expand(newBlocks, state.doc, from, to));
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    addOld(fromA, toA);
    addNew(fromB, toB);
  });
  // Cursor-dependent decorations (revealed markup) change where it was and is
  if (tr.docChanged || !startState.selection.eq(state.selection)) {
    for (const r of startState.selection.ranges) addOld(r.from, r.to);
    for (const r of state.selection.ranges) addNew(r.from, r.to);
  }
  // Past the end of a partial parse nothing is decorated; where it ends, the
  // last block may be cut short
  if (!oldComplete) addOld(oldTree.length, startState.doc.length);
  if (!newComplete) addNew(newTree.length, state.doc.length);
  const merged = merge(regions);
  if (merged.length === 0) return [];

  // Builders only visit parsed nodes, so that is what a region costs
  let dirty = 0;
  for (const r of merged) {
    dirty += Math.max(0, Math.min(r.to, newTree.length) - r.from);
  }
  if (dirty > newTree.length * maxDirtyShare) return null;

  // Outside the regions, the parse must have kept every block as it was:
  // an opened code fence or list can swallow blocks past the edit
  const outsideNew = newBlocks.filter((b) => !inRegions(merged, b.from, b.to));
  let i = 0;
  for (const b of oldBlocks) {
    const from = tr.changes.mapPos(b.from, 1);
    const to = tr.changes.mapPos(b.to, -1);
    if (inRegions(merged, from, to)) continue;
    const other = outsideNew[i++];
    if (
      !other ||
      other.from !== from ||
      other.to !== to ||
      other.name !== b.name
    ) {
      return null;
    }
  }
  if (i !== outsideNew.length) return null;
  return merged;
}

/**
 * The parts of the page whose decorations a transaction can have changed,
 * or null when everything has to rebuild. Shared by all decoration fields.
 */
export function dirtyRegions(tr: Transaction): DirtyRegion[] | null {
  let regions = regionCache.get(tr);
  if (regions === undefined) {
    regions = computeDirtyRegions(tr);
    regionCache.set(tr, regions);
  }
  return regions;
}

function widgetKey(deco: Decoration): string | undefined {
  const key = (deco.spec.widget as { cacheKey?: unknown } | undefined)
    ?.cacheKey;
  return typeof key === "string" ? key : undefined;
}

function keysBetween(set: DecorationSet, from: number, to: number) {
  const keys: string[] = [];
  set.between(from, to, (rangeFrom, _to, deco) => {
    if (rangeFrom < from || rangeFrom > to) return;
    const key = widgetKey(deco);
    if (key !== undefined) keys.push(key);
  });
  return keys;
}

/**
 * Map `value` through the transaction and rebuild only its dirty regions,
 * or return null when the builder has to rebuild the whole page.
 */
export function updateDecorations(
  value: DecorationSet,
  tr: Transaction,
  build: DecorationBuilder,
  options: IncrementalDecorations,
): DecorationSet | null {
  const regions = dirtyRegions(tr);
  if (!regions) return null;
  if (regions.length === 0) return value;
  const { pageWide, keyed } = options;
  if (pageWide) {
    for (const r of regions) {
      if (pageWide(tr.state, r.from, r.to)) return null;
      const oldFrom = tr.changes.invertedDesc.mapPos(r.from, -1);
      const oldTo = tr.changes.invertedDesc.mapPos(r.to, 1);
      if (pageWide(tr.startState, oldFrom, oldTo)) return null;
    }
  }
  // Numbering continues across regions only in a single pass
  if (keyed && regions.length > 1) return null;

  const mapped = value.map(tr.changes);
  const added: Range<Decoration>[] = [];
  for (const r of regions) {
    const keys = new OccurrenceKeys();
    if (keyed) {
      for (const key of keysBetween(mapped, 0, r.from - 1)) keys.seed(key);
    }
    const built = build(tr.state, tr, { ...r, keys });
    const builtKeys: string[] = [];
    built.between(r.from, r.to, (from, to, deco) => {
      if (from < r.from || from > r.to) return;
      added.push(deco.range(from, to));
      if (keyed) {
        const key = widgetKey(deco);
        if (key !== undefined) builtKeys.push(key);
      }
    });
    // Later copies of an expression keep their numbers only if this region
    // still holds the same ones
    if (keyed) {
      const before = keysBetween(mapped, r.from, r.to);
      if (
        before.length !== builtKeys.length ||
        before.some((key, n) => key !== builtKeys[n])
      ) {
        return null;
      }
    }
  }
  return mapped.update({
    filter: (from) => !regions.some((r) => from >= r.from && from <= r.to),
    filterFrom: regions[0].from,
    filterTo: regions[regions.length - 1].to,
    add: added,
    sort: true,
  });
}

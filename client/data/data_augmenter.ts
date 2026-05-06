/**
 * Out-of-band data augmentation: persistent per-key key/value records that
 * decorate index objects with mutable, per-client metadata (e.g. `lastAccessed`
 * for pages, `lastRun` for commands). Augmenter values are stored in the KV
 * store under a fixed namespace and held in an in-memory cache so that:
 *
 * - object overlay during query execution is O(1) per row, and
 * - the query planner can synchronously expose virtual-column statistics.
 */
import type { KvKey } from "@silverbulletmd/silverbullet/type/datastore";
import type { DataStore } from "./datastore.ts";
import type { QueryEngineCapability } from "../space_lua/query_collection.ts";

export type AugmenterMatchPredicate =
  | { kind: "eq"; column: string; value: string | number | boolean }
  | { kind: "neq"; column: string; value: string | number | boolean }
  | { kind: "gt"; column: string; value: string | number | boolean }
  | { kind: "gte"; column: string; value: string | number | boolean }
  | { kind: "lt"; column: string; value: string | number | boolean }
  | { kind: "lte"; column: string; value: string | number | boolean }
  | { kind: "is-nil"; column: string }
  | { kind: "is-not-nil"; column: string };

/**
 * Evaluate a single non-`is-nil` augmenter predicate against the cached
 * record `v`. Returns true if the column is present and the comparison
 * holds; `is-nil` is handled separately by the caller because absent
 * keys are not in `v`'s domain.
 */
function matchOne(
  v: Record<string, any>,
  pred: Exclude<AugmenterMatchPredicate, { kind: "is-nil" }>,
): boolean {
  const x = v[pred.column];
  if (pred.kind === "is-not-nil") return x !== undefined && x !== null;
  if (x === undefined || x === null) return false;
  // Strict-typed comparison: mismatched types never match (mirrors
  // `compareValues` in object_index.ts).
  if (typeof x !== typeof pred.value) {
    if (pred.kind === "neq") return true;
    return false;
  }
  switch (pred.kind) {
    case "eq":
      return x === pred.value;
    case "neq":
      return x !== pred.value;
    case "lt":
      return x < pred.value;
    case "lte":
      return x <= pred.value;
    case "gt":
      return x > pred.value;
    case "gte":
      return x >= pred.value;
  }
}

export class Augmenter {
  private cache = new Map<string, Record<string, any>>();
  private loaded = false;
  private loadingPromise: Promise<void> | undefined;
  private declaredColumns: ReadonlyArray<string>;

  constructor(
    private ds: DataStore,
    private augmentationNamespace: KvKey,
    declaredColumns: ReadonlyArray<string> = [],
  ) {
    this.declaredColumns = [...new Set(declaredColumns)].sort();
  }

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this.loadInner();
    return this.loadingPromise;
  }

  private async loadInner(): Promise<void> {
    const writebacks: Array<{ key: KvKey; value: Record<string, any> }> = [];
    for await (const { key, value } of this.ds.query<Record<string, any>>({
      prefix: this.augmentationNamespace,
    })) {
      const k = key[this.augmentationNamespace.length] as string;
      this.cache.set(k, value);
    }
    if (writebacks.length > 0) {
      await this.ds.batchSet(writebacks);
    }
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Synchronously read the cached augmentation for `key`. Caller must have
   * awaited `load()` first; otherwise this may return undefined for keys that
   * actually exist in KV.
   */
  getCached(key: string): Record<string, any> | undefined {
    return this.cache.get(key);
  }

  entries(): IterableIterator<[string, Record<string, any>]> {
    return this.cache.entries();
  }

  size(): number {
    return this.cache.size;
  }

  // Number of distinct values stored under `column` across all entries.
  ndvForColumn(column: string): number {
    const seen = new Set<unknown>();
    for (const v of this.cache.values()) {
      const x = v[column];
      if (x !== undefined) seen.add(x);
    }
    return seen.size;
  }

  // Number of entries that have a non-undefined value for `column`.
  rowCountForColumn(column: string): number {
    let n = 0;
    for (const v of this.cache.values()) {
      if (v[column] !== undefined) n++;
    }
    return n;
  }

  // Declared columns ∪ any column ever observed in a cached entry.
  knownColumns(): string[] {
    const cols = new Set<string>(this.declaredColumns);
    for (const v of this.cache.values()) {
      for (const c of Object.keys(v)) cols.add(c);
    }
    return [...cols].sort();
  }

  // Augment objects in `objects` with cached augmentation, keyed by `keyField`.
  async augmentObjectArray(objects: any[], keyField: string): Promise<void> {
    await this.load();
    for (const obj of objects) {
      const aug = this.cache.get(obj[keyField]);
      if (aug) Object.assign(obj, aug);
    }
  }

  async augmentObjectMap(objectMap: Map<string, any>): Promise<void> {
    await this.load();
    for (const [k, obj] of objectMap) {
      const aug = this.cache.get(k);
      if (aug) Object.assign(obj, aug);
    }
  }

  /**
   * Resolve a conjunction of augmenter-owned predicates against the in-memory
   * cache. Returns keys that satisfy all predicates and whether the caller must
   * also enumerate the universe (needed only for pure `is-nil` conjunctions,
   * since absence trivially satisfies them). Non-nil predicates require a
   * concrete value, so unmatched keys cannot qualify.
   *
   * Returns `undefined` when `predicates` is empty. Caller must `await load()`.
   */
  matchMultiplePredicates(predicates: AugmenterMatchPredicate[]):
    | {
        cacheKeys: Set<string>;
        needsUniverse: boolean;
      }
    | undefined {
    if (predicates.length === 0) return undefined;

    const cacheBound = predicates.filter(
      (p): p is Exclude<AugmenterMatchPredicate, { kind: "is-nil" }> =>
        p.kind !== "is-nil",
    );
    const nilPreds = predicates.filter(
      (p): p is { kind: "is-nil"; column: string } => p.kind === "is-nil",
    );

    // Single pass over the cache
    const cacheKeys = new Set<string>();
    outer: for (const [k, v] of this.cache.entries()) {
      for (const p of cacheBound) {
        if (!matchOne(v, p)) continue outer;
      }
      for (const p of nilPreds) {
        if (v[p.column] !== undefined) continue outer;
      }
      cacheKeys.add(k);
    }

    const needsUniverse = cacheBound.length === 0 && nilPreds.length > 0;
    return { cacheKeys, needsUniverse };
  }

  /**
   * Describe the augmenter as a query engine that the planner can route
   * predicates to. Mirrors `Object index bitmap extended scan` but tagged
   * with the augmenter's overlay tag name so each tag with an augmenter
   * registers a distinct, identifiable engine in the EXPLAIN output.
   *
   * Caller must `await load()` first so capability advertisement is
   * grounded in real cache contents.
   */
  engineSpec(tagName: string): QueryEngineCapability {
    return {
      id: `augmenter-overlay-${tagName}`,
      name: `Augmenter overlay (${tagName})`,
      kind: "overlay",
      capabilities: [
        "scan-augmenter",
        "stage-where-augmenter",
        "pred-eq",
        "pred-neq",
        "pred-lt",
        "pred-lte",
        "pred-gt",
        "pred-gte",
        "pred-is-nil",
        "pred-is-not-nil",
        "expr-literal",
        "expr-column-qualified",
        "bool-and",
        "stats-row-count",
        "stats-ndv",
      ],
      // Augmenter resolution is an in-memory hash map lookup per row, so
      // it is cheaper than a bitmap scan; keep it strictly under the
      // bitmap engine's 0.6 baseCostWeight so the planner prefers the
      // augmenter for columns it owns.
      baseCostWeight: 0.4,
      capabilityCosts: {
        "pred-eq": 0.5,
        "pred-neq": 0.6,
        "pred-lt": 0.6,
        "pred-lte": 0.6,
        "pred-gt": 0.6,
        "pred-gte": 0.6,
        "pred-is-nil": 0.5,
        "pred-is-not-nil": 0.5,
      },
      // Higher priority than the default bitmap engine (20) so per-engine
      // dispatch picks the augmenter for augmenter-owned columns first.
      priority: 25,
      metadata: {
        overlay: tagName,
      },
    };
  }

  async setAugmentation(
    key: string,
    augmentation: Record<string, any>,
  ): Promise<void> {
    // Serialize against any in-flight initial load. Without this, an iterator
    // started before our write may miss the entry, leaving the cache stale.
    if (this.loadingPromise) {
      await this.loadingPromise;
    }
    await this.ds.set([...this.augmentationNamespace, key], augmentation);
    if (this.loaded) {
      this.cache.set(key, augmentation);
    }
  }
}

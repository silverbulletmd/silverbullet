import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { Config } from "../config.ts";
import {
  ArrayQueryCollection,
  applyQuery,
  type LuaCollectionQuery,
  type LuaQueryCollection,
  type LuaQueryCollectionWithStats,
  type CollectionStats,
  type QueryEngineCapability,
  type QueryInstrumentation,
  type VirtualColumnInfo,
} from "../space_lua/query_collection.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
} from "../space_lua/runtime.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import type { DataStore } from "./datastore.ts";
import type { KV, KvKey } from "@silverbulletmd/silverbullet/type/datastore";
import type { EventHook } from "../plugos/hooks/event.ts";
import { AbortError, type DataStoreMQ } from "./mq.datastore.ts";
import type { Space } from "../space.ts";
import { validateObject } from "../plugos/syscalls/jsonschema.ts";
import {
  getAggregateSpec,
  getBuiltinAggregateEntries,
} from "../space_lua/aggregates.ts";
import {
  BitmapIndex,
  type BitmapIndexConfig,
  type EncodedObject,
} from "./bitmap/bitmap_index.ts";
import { RoaringBitmap } from "./bitmap/roaring_bitmap.ts";
import { MCVList } from "../space_lua/mcv.ts";
import type { Augmenter } from "./data_augmenter.ts";
import {
  BitmapEngine,
  type BitmapEngineColumnSnapshot,
  type BitmapEngineHost,
  type BitmapEngineHostSnapshot,
} from "./bitmap_engine.ts";
import {
  AugmenterEngine,
  type AugmenterEngineColumnSnapshot,
  type AugmenterEngineHost,
  type AugmenterEngineHostSnapshot,
} from "./augmenter_engine.ts";
import { bindPredicate } from "../space_lua/bind_predicate.ts";
import {
  dispatchPredicate,
  noopInstrumentation,
} from "../space_lua/dispatch_predicate.ts";
import type { PlanContext, QueryEngine } from "../space_lua/engine_contract.ts";

// KV key prefixes
const indexKey = "idx";
const reverseKey = "ridx";

const indexStateKey = ["$indexState"];
const legacyIndexVersionKey = ["$indexVersion"];

// Bump this every time a full reindex is needed (KV layout / encoder change)
const desiredIndexSchema = 10;

export type IndexState = {
  schema: number;
  pass1Complete: boolean;
  pass2Complete: boolean;
  scriptsHash?: string;
};

const textEncoder = new TextEncoder();

type TagDefinition = {
  tagPage?: string;
  metatable?: any;
  mustValidate?: boolean;
  schema?: any;
  validate?: (o: ObjectValue) => Promise<string | null | undefined>;
  transform?: (
    o: ObjectValue,
  ) =>
    | Promise<ObjectValue[] | ObjectValue>
    | ObjectValue[]
    | ObjectValue
    | null;
};

type BitmapPredicate =
  | {
      kind: "eq";
      column: string;
      value: string | number | boolean;
    }
  | {
      kind: "neq";
      column: string;
      value: string | number | boolean;
    }
  | {
      kind: "gt";
      column: string;
      value: string | number | boolean;
    }
  | {
      kind: "gte";
      column: string;
      value: string | number | boolean;
    }
  | {
      kind: "lt";
      column: string;
      value: string | number | boolean;
    }
  | {
      kind: "lte";
      column: string;
      value: string | number | boolean;
    }
  | {
      kind: "in";
      column: string;
      values: (string | number | boolean)[];
    };

/**
 * Predicate kinds the augmenter virtual index can resolve directly
 * against its in-memory cache. Mirrors a subset of `BitmapPredicate`
 * plus nil-checks (which are how callers ask "row has/has-not been
 * augmented for this column").
 */
export type AugmenterPredicate =
  | { kind: "eq"; column: string; value: string | number | boolean }
  | { kind: "neq"; column: string; value: string | number | boolean }
  | { kind: "gt"; column: string; value: string | number | boolean }
  | { kind: "gte"; column: string; value: string | number | boolean }
  | { kind: "lt"; column: string; value: string | number | boolean }
  | { kind: "lte"; column: string; value: string | number | boolean }
  | { kind: "is-nil"; column: string }
  | { kind: "is-not-nil"; column: string };

type IndexStorageStats = {
  bitmapBytes: number;
  metaBytes: number;
  dictionaryBytes: number;
  objectBytes: number;
  indexBytes: number;
  totalBytes: number;
};

type StorageStatsRow = {
  scope: "tag" | "global";
  tag: string | null;
  rowCount: number | null;
  bitmapBytes: number;
  metaBytes: number;
  dictionaryBytes: number | null;
  objectBytes: number;
  indexBytes: number;
  totalBytes: number;
};

function compareValues(
  indexed: string | number | boolean,
  threshold: string | number | boolean,
  kind: "gt" | "gte" | "lt" | "lte",
): boolean {
  // Type mismatch: no match
  if (typeof indexed !== typeof threshold) return false;

  switch (kind) {
    case "gt":
      return indexed > threshold;
    case "gte":
      return indexed >= threshold;
    case "lt":
      return indexed < threshold;
    case "lte":
      return indexed <= threshold;
  }
}

export class ObjectValidationError extends Error {
  constructor(
    message: string,
    readonly object: ObjectValue,
  ) {
    super(message);
  }
}

export class ObjectIndex {
  private bitmapIndex: BitmapIndex;
  // When true, batchSet skips reverse-key lookups (fresh insert only)
  private _freshMode = false;
  private currentReindex?: {
    controller: AbortController;
    promise: Promise<void>;
  };

  /**
   * Per-tag virtual column providers. Their values are overlaid onto query
   * results and surfaced in stats() output, but are NOT bitmap-indexed and
   * therefore cannot participate in predicate pushdown.
   */
  private augmenters = new Map<string, Augmenter>();

  constructor(
    private ds: DataStore,
    private config: Config,
    private eventHook: EventHook,
    private mq: DataStoreMQ,
    bitmapConfig?: Partial<BitmapIndexConfig>,
  ) {
    this.bitmapIndex = new BitmapIndex(bitmapConfig);

    this.eventHook.addLocalListener("file:deleted", (path: string) => {
      return this.clearFileIndex(path);
    });
  }

  /**
   * Register a virtual-column provider for `tagName`. The augmenter's cached
   * record for an object's `ref` is overlaid onto the decoded object before
   * predicate evaluation, and its columns are reported by stats() with
   * `indexed: false` and `scanKind: "augmenter-overlay"`.
   *
   * Caller is responsible for calling `augmenter.load()` (or any method that
   * triggers it) before queries run. ObjectIndex query paths await
   * `ensureAugmenterLoaded` defensively.
   */
  registerAugmenter(tagName: string, augmenter: Augmenter): void {
    this.augmenters.set(tagName, augmenter);
  }

  getAugmenter(tagName: string): Augmenter | undefined {
    return this.augmenters.get(tagName);
  }

  private async ensureAugmenterLoaded(tagName: string): Promise<void> {
    const a = this.augmenters.get(tagName);
    if (a) await a.load();
  }

  /**
   * Overlay augmenter values for `tagName` onto a decoded plain-JS object.
   * Must be invoked before `enrichValue` (which may wrap into a Lua table).
   * No-op when no augmenter is registered.  Two passes:
   *
   *   1. Schema-fill: every column name the augmenter has ever observed
   *      (`augmenter.knownColumns()`) is materialised on the value as
   *      `null` if the value does not already have it. This guarantees
   *      that the row-shape of a tag is consistent across augmented and
   *      unaugmented rows - a SQL-like contract that lets `select *`
   *      and explicit projections (`select name, lastAccessed`) surface
   *      the column even when its value is missing for the chosen row.
   *
   *      Without this fill, `select *` from `index.tag 'page' limit 1`
   *      could pick an unaugmented page and omit `lastAccessed`
   *      entirely from the result, while a query with `where lastAccessed`
   *      (which narrows to augmented rows) would see the column.
   *
   *   2. Value-overlay: for refs that DO have a cached augmentation,
   *      copy each augmented field onto the value (preserving any
   *      pre-existing same-named field on the underlying object).
   *
   * The schema-fill uses plain JS `null` (Lua nil) so truthiness
   * predicates (`where lastAccessed`) and `pred-is-nil` / `pred-is-not-nil`
   * engines behaviour is guaranteed.
   */
  private overlayAugmenterValues(tagName: string, value: any): void {
    const a = this.augmenters.get(tagName);
    if (!a) return;
    const ref = value?.ref;
    if (typeof ref !== "string") return;

    // Pass 1: fill every known virtual-column key with `null` so the
    // row's shape is uniform across augmented and unaugmented rows.
    // Track which keys we filled so Pass 2 can distinguish a
    // schema-fill `null` from an underlying-object `null` (which we
    // must preserve to keep the existing "underlying field wins"
    // contract for cached augmentations).
    const filledByOverlay = new Set<string>();
    for (const col of a.knownColumns()) {
      if (value[col] === undefined) {
        value[col] = null;
        filledByOverlay.add(col);
      }
    }

    // Pass 2: overlay actual augmentation values for refs that have
    // them. We replace a Pass-1 schema-fill `null` (because the
    // underlying object did not carry the key at all) but leave any
    // pre-existing field (including an explicit `null` set by the
    // underlying object) untouched.
    const aug = a.getCached(ref);
    if (!aug) return;
    for (const [k, v] of Object.entries(aug)) {
      if (filledByOverlay.has(k) || value[k] === undefined) {
        value[k] = v;
      }
    }
  }

  private enrichValue(tagName: string, value: any): any {
    this.overlayAugmenterValues(tagName, value);
    const mt = this.config.get<LuaTable | undefined>(
      ["tags", tagName, "metatable"],
      undefined,
    );
    if (!mt) return value;
    value = jsToLuaValue(value);
    value.metatable = mt;
    return value;
  }

  private allKnownTags(): string[] {
    const tags: string[] = [];
    for (const tagId of this.bitmapIndex.allTagIds()) {
      const decoded = this.bitmapIndex.getDictionary().decodeValue(tagId);
      if (typeof decoded === "string") {
        tags.push(decoded);
      }
    }
    tags.sort();
    return tags;
  }

  private estimateStoredValueSize(value: unknown): number {
    if (value === null || value === undefined) {
      return 0;
    }

    if (value instanceof Uint8Array) {
      return value.byteLength;
    }

    if (typeof value === "string") {
      return textEncoder.encode(value).byteLength;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return textEncoder.encode(String(value)).byteLength;
    }

    try {
      return textEncoder.encode(JSON.stringify(value)).byteLength;
    } catch {
      return 0;
    }
  }

  private async computeIndexStorageStats(
    tagName?: string,
  ): Promise<IndexStorageStats> {
    let bitmapBytes = 0;
    let metaBytes = 0;
    let dictionaryBytes = 0;
    let objectBytes = 0;

    if (tagName) {
      for await (const { value } of this.ds.query({
        prefix: [indexKey, tagName],
      })) {
        objectBytes += this.estimateStoredValueSize(value);
      }

      const tagId = this.bitmapIndex.getDictionary().tryEncode(tagName);
      if (tagId !== undefined) {
        for await (const { value } of this.ds.query({
          prefix: ["b", String(tagId)],
        })) {
          bitmapBytes += this.estimateStoredValueSize(value);
        }

        const meta = await this.ds.get(["m", String(tagId)]);
        if (meta !== undefined && meta !== null) {
          metaBytes += this.estimateStoredValueSize(meta);
        }
      }
    } else {
      for await (const { value } of this.ds.query({
        prefix: [indexKey],
      })) {
        objectBytes += this.estimateStoredValueSize(value);
      }

      for await (const { value } of this.ds.query({
        prefix: ["b"],
      })) {
        bitmapBytes += this.estimateStoredValueSize(value);
      }

      for await (const { value } of this.ds.query({
        prefix: ["m"],
      })) {
        metaBytes += this.estimateStoredValueSize(value);
      }
    }

    const dictSnapshot = await this.ds.get(["$dict"]);
    if (dictSnapshot !== undefined && dictSnapshot !== null) {
      dictionaryBytes = this.estimateStoredValueSize(dictSnapshot);
    }

    const indexBytes = bitmapBytes + metaBytes + dictionaryBytes;
    const totalBytes = indexBytes + objectBytes;

    return {
      bitmapBytes,
      metaBytes,
      dictionaryBytes,
      objectBytes,
      indexBytes,
      totalBytes,
    };
  }

  tag(tagName: string): LuaQueryCollectionWithStats {
    if (!tagName) {
      throw new Error("Tag name is required");
    }

    const self = this;

    return {
      async query(
        query: LuaCollectionQuery,
        env: LuaEnv,
        sf: LuaStackFrame,
        config?: Config,
        instrumentation?: QueryInstrumentation,
      ): Promise<ObjectValue<any>[]> {
        // Load augmenter cache before any enrichValue() runs, so virtual
        // columns (e.g. `lastAccessed`) are populated for predicate eval.
        await self.ensureAugmenterLoaded(tagName);

        const objectVariable = query.objectVariable;

        if (objectVariable !== undefined) {
          const engines: QueryEngine[] = [];
          engines.push(await self.createBitmapEngine(tagName));
          const augmenterEngine = await self.createAugmenterEngine(tagName);
          if (augmenterEngine) engines.push(augmenterEngine);

          const bound = bindPredicate(query.where, objectVariable);

          const ctx: PlanContext = {
            phase: "source-leaf",
            smallSetThreshold: 100,
            peerEngines: engines.map((e) => e.spec()),
          };

          const result = await dispatchPredicate(bound, engines, ctx, () =>
            noopInstrumentation(),
          );

          if (instrumentation?.onEngineDispatch) {
            const runs =
              result.kind === "narrowed" ? result.runs : result.declined;
            instrumentation.onEngineDispatch(
              runs.map((r) => ({
                engineId: r.spec.id,
                engineName: r.spec.name,
                engineKind: r.spec.kind,
                baseCostWeight: r.spec.baseCostWeight,
                priority: r.spec.priority,
                contributed: r.contributed,
                declineReason: r.declineReason,
                rowsReturned: r.rowsReturned,
                // Forward the dispatcher's captured per-engine runtime
                // stats so EXPLAIN ANALYZE can attribute work to the
                // specific engine.
                runtimeStats: r.runtimeStats,
                executeMs: r.executeMs,
              })),
            );
          }

          if (result.kind === "narrowed") {
            const finalIds = [...result.ids].sort((a, b) => a - b);
            const prefetched = await self.loadObjectsByObjectIds(
              tagName,
              finalIds,
            );
            const finalRows = await applyQuery(
              prefetched,
              query,
              env,
              sf,
              config,
              instrumentation,
            );

            // Surface the narrowing breakdown so EXPLAIN ANALYZE can
            // split the rows-removed counter into engine-narrowed
            // (pushdown) vs row-by-row residua.
	    //
            // Unfiltered count is the relation's bitmap row count;
	    // if the tag is unknown, fall back to the narrowed count
	    // so the report stays self-consistent.
            if (instrumentation?.onPushdownNarrowed) {
              const dict = self.bitmapIndex.getDictionary();
              const tagId = dict.tryEncode(tagName);
              const unfilteredRowCount =
                tagId !== undefined
                  ? self.bitmapIndex.getRowCount(tagId)
                  : result.ids.size;
              instrumentation.onPushdownNarrowed({
                unfilteredRowCount,
                narrowedRowCount: result.ids.size,
                finalRowCount: finalRows.length,
              });
            }
            return finalRows;
          }
        }

        const results: ObjectValue<any>[] = [];
        for await (const { value } of self.ds.query({
          prefix: [indexKey, tagName],
        })) {
          const decoded = self.bitmapIndex.decodeObject(
            value as EncodedObject,
          ) as ObjectValue<any>;
          results.push(self.enrichValue(tagName, decoded));
        }
        return applyQuery(results, query, env, sf, config, instrumentation);
      },

      async isTagIndexTrusted(): Promise<boolean> {
        return self.isTagIndexTrusted(tagName);
      },

      async getStats(): Promise<CollectionStats> {
        const tagId = self.bitmapIndex.getDictionary().tryEncode(tagName);
        const indexTrusted = await self.isTagIndexTrusted(tagName);

        if (tagId === undefined) {
          return {
            rowCount: 0,
            ndv: new Map(),
            avgColumnCount: 0,
            statsSource: "computed-empty",
            executionCapabilities: {
              engines: [
                {
                  id: "object-index-empty-scan",
                  name: "Object index empty scan",
                  kind: "index",
                  capabilities: ["scan-index"],
                  baseCostWeight: 1.0,
                },
              ],
            },
          };
        }
        const rowCount = self.bitmapIndex.getRowCount(tagId);
        const meta = self.bitmapIndex.getTagMetaById(tagId);

        const indexComplete = await self.hasFullIndexCompleted();
        const statsSource = indexComplete
          ? "persisted-complete"
          : "persisted-partial";

        // When the index is still building, NDV and MCV values are
        // underestimated and would mislead the join planner into
        // picking catastrophically wrong plans. Return empty maps
        // so the planner falls back to row-count heuristics.
        const ndv = new Map<string, number>();
        const mcv = new Map<string, MCVList>();

        if (indexComplete && meta) {
          for (const [col, colMeta] of Object.entries(meta.columns)) {
            ndv.set(col, colMeta.ndv);

            const topValues = self.bitmapIndex.getColumnMCV(tagId, col);
            if (topValues.length > 0) {
              const list = new MCVList();
              for (const { value, count } of topValues) {
                list.setDirect(value, count);
              }
              mcv.set(col, list);
            }
          }
        }

        // Surface augmenter-provided virtual columns to the planner so
        // EXPLAIN VERBOSE can annotate them under the scan node. The
        // augmenter is also registered as a separate engine below so
        // the planner can route predicates for augmenter-owned columns
        // to it.
        const augmenter = self.augmenters.get(tagName);
        let virtualColumns: VirtualColumnInfo[] | undefined;
        let augmenterEngine: QueryEngineCapability | undefined;
        if (augmenter) {
          await augmenter.load();
          const virtCols = augmenter.knownColumns();
          if (virtCols.length > 0) {
            virtualColumns = virtCols.map((column) => ({
              column,
              overlay: tagName,
              rowCount: augmenter.rowCountForColumn(column),
              ndv: augmenter.ndvForColumn(column),
            }));
            augmenterEngine = augmenter.engineSpec(tagName);
          }
        }

        return {
          rowCount,
          ndv,
          avgColumnCount:
            rowCount > 0 && meta
              ? Math.round(meta.totalColumnCount / rowCount)
              : 0,
          mcv: mcv.size > 0 ? mcv : undefined,
          statsSource,
          virtualColumns,
          executionCapabilities: {
            engines: [
              {
                id: indexTrusted
                  ? "object-index-bitmap-extended"
                  : "object-index-scan",
                name: indexTrusted
                  ? "Object index bitmap extended scan"
                  : "Object index scan",
                kind: "index",
                capabilities: indexTrusted
                  ? [
                      "scan-index",
                      "scan-bitmap",
                      "stage-where",
                      "pred-eq",
                      "pred-neq",
                      "pred-in",
                      "pred-gt",
                      "pred-gte",
                      "pred-lt",
                      "pred-lte",
                      "expr-literal",
                      "expr-column-qualified",
                      "expr-column-unqualified",
                      "bool-and",
                      "bool-or",
                      "bool-not",
                      "stats-row-count",
                      ...(indexComplete
                        ? (["stats-ndv", "stats-mcv"] as const)
                        : []),
                    ]
                  : [
                      "scan-index",
                      "stats-row-count",
                      ...(indexComplete
                        ? (["stats-ndv", "stats-mcv"] as const)
                        : []),
                    ],
                baseCostWeight: indexTrusted ? 0.6 : 1.0,
                capabilityCosts: indexTrusted
                  ? {
                      "pred-eq": 0.7,
                      "pred-neq": 0.9,
                      "pred-in": 0.75,
                      "pred-gt": 0.8,
                      "pred-gte": 0.8,
                      "pred-lt": 0.8,
                      "pred-lte": 0.8,
                      "bool-and": 0.7,
                      "bool-or": 0.75,
                      "bool-not": 0.85,
                    }
                  : undefined,
                priority: indexTrusted ? 20 : 10,
              },
              ...(augmenterEngine ? [augmenterEngine] : []),
            ],
          },
        };
      },
    };
  }

  async createBitmapEngine(tagName: string): Promise<BitmapEngine> {
    if (!tagName) {
      throw new Error("Tag name is required");
    }

    const trusted = await this.isTagIndexTrusted(tagName);
    const indexComplete = await this.hasFullIndexCompleted();
    const queueIdle = await this.mq.isQueueEmpty("indexQueue");
    const trustedAndIdle = trusted && queueIdle;

    const dict = this.bitmapIndex.getDictionary();
    const tagId = dict.tryEncode(tagName);
    const meta =
      tagId !== undefined ? this.bitmapIndex.getTagMetaById(tagId) : undefined;
    const rowCount =
      tagId !== undefined ? this.bitmapIndex.getRowCount(tagId) : 0;
    const averageColumnCount =
      rowCount > 0 && meta ? Math.round(meta.totalColumnCount / rowCount) : 0;

    // Per-column snapshot - surface only `indexed` columns to the
    // engine (it cannot serve predicates on non-indexed columns); NDV
    // is captured at create time and stays stable for the engine's
    // lifetime.
    const alwaysIndexedColumns =
      this.bitmapIndex.getConfig().alwaysIndexColumns;
    const columns: BitmapEngineColumnSnapshot[] = meta
      ? Object.entries(meta.columns).map(([name, colMeta]) => ({
          name,
          indexed: colMeta.indexed,
          ndv: indexComplete ? colMeta.ndv : undefined,
          mcvSize: indexComplete
            ? this.bitmapIndex.getColumnMCV(tagId!, name).length
            : undefined,
          alwaysIndexed: alwaysIndexedColumns.includes(name),
        }))
      : [];

    const snapshot: BitmapEngineHostSnapshot = {
      tagName,
      trusted: trustedAndIdle,
      indexComplete,
      columns,
      rowCount,
      averageColumnCount,
    };

    const host: BitmapEngineHost = {
      snapshot: () => snapshot,
      matchPredicates: (preds) =>
        this.bitmapMatchMultiplePredicates(tagName, preds),
      loadObjects: (ids) => this.loadObjectsByObjectIds(tagName, ids),
    };

    return BitmapEngine.create(host);
  }

  async createAugmenterEngine(
    tagName: string,
  ): Promise<AugmenterEngine | undefined> {
    if (!tagName) {
      throw new Error("Tag name is required");
    }
    const augmenter = this.augmenters.get(tagName);
    if (!augmenter) return undefined;

    // Snapshot must be loaded; the engine is sync after creation and the
    // overlay is useless until the cache is hot.
    await augmenter.load();

    const knownColumns = augmenter.knownColumns();
    const columns: AugmenterEngineColumnSnapshot[] = knownColumns.map(
      (name) => ({
        name,
        rowCount: augmenter.rowCountForColumn(name),
        ndv: augmenter.ndvForColumn(name),
      }),
    );

    const snapshot: AugmenterEngineHostSnapshot = {
      tagName,
      loaded: augmenter.isLoaded(),
      columns,
      cacheSize: augmenter.size(),
    };

    const host: AugmenterEngineHost = {
      snapshot: () => snapshot,
      matchPredicates: (preds) => augmenter.matchMultiplePredicates(preds),
      lookupObjectIdsByKeys: (refs) =>
        this.lookupObjectIdsByKeys(tagName, refs),
      allObjectIdsForTag: () => this.allObjectIdsForTag(tagName),
      cachedKeys: function* () {
        for (const [k] of augmenter.entries()) yield k;
      },
    };

    return AugmenterEngine.create(host);
  }

  async stats(tagName?: string): Promise<LuaQueryCollection> {
    if (tagName === "") {
      throw new Error("Tag name is required");
    }

    const tags = tagName === undefined ? this.allKnownTags() : [tagName];
    const rows: Record<string, any>[] = [];
    const indexComplete = await this.hasFullIndexCompleted();

    for (const tag of tags) {
      const tagId = this.bitmapIndex.getDictionary().tryEncode(tag);
      const indexTrusted = await this.isTagIndexTrusted(tag);

      if (tagId === undefined) {
        rows.push({
          tag,
          column: null,
          rowCount: 0,
          avgColumnCount: 0,
          ndv: null,
          indexed: null,
          statsSource: "computed-empty",
          predicatePushdown: "none",
          scanKind: "index-scan",
          trackedMcvValues: 0,
        });
        await this.appendAugmenterStatsRows(tag, 0, rows);
        continue;
      }

      const meta = this.bitmapIndex.getTagMetaById(tagId);
      const rowCount = this.bitmapIndex.getRowCount(tagId);
      const avgColumnCount =
        rowCount > 0 && meta ? Math.round(meta.totalColumnCount / rowCount) : 0;
      const statsSource = indexComplete
        ? "persisted-complete"
        : "persisted-partial";
      const predicatePushdown = indexTrusted ? "bitmap-extended" : "none";
      const scanKind = "index-scan";

      rows.push({
        tag,
        column: null,
        rowCount,
        avgColumnCount,
        ndv: null,
        indexed: null,
        statsSource,
        predicatePushdown,
        scanKind,
        trackedMcvValues: 0,
      });

      if (meta && Object.keys(meta.columns).length > 0) {
        const columns = Object.keys(meta.columns).sort();
        const alwaysIndexedColumns =
          this.bitmapIndex.getConfig().alwaysIndexColumns;
        for (const column of columns) {
          const colMeta = meta.columns[column];
          const trackedMcvValues = this.bitmapIndex.getColumnMCV(
            tagId,
            column,
          ).length;

          rows.push({
            tag,
            column,
            rowCount,
            avgColumnCount,
            ndv: colMeta.ndv,
            indexed: colMeta.indexed,
            alwaysIndexed: alwaysIndexedColumns.includes(column),
            statsSource,
            predicatePushdown,
            scanKind,
            trackedMcvValues,
          });
        }
      }

      await this.appendAugmenterStatsRows(tag, avgColumnCount, rows);
    }

    return new ArrayQueryCollection(rows);
  }

  /**
   * Emit one stats row per virtual (augmenter-provided) column for `tag`.
   * `rowCount` reflects how many objects in the augmenter cache hold a value
   * for that column (i.e. overlay coverage), not the bitmap row count.
   */
  private async appendAugmenterStatsRows(
    tag: string,
    avgColumnCount: number,
    rows: Record<string, any>[],
  ): Promise<void> {
    const augmenter = this.augmenters.get(tag);
    if (!augmenter) return;
    await augmenter.load();
    const columns = augmenter.knownColumns();
    for (const column of columns) {
      rows.push({
        tag,
        column,
        rowCount: augmenter.rowCountForColumn(column),
        avgColumnCount,
        ndv: augmenter.ndvForColumn(column),
        indexed: false,
        alwaysIndexed: false,
        statsSource: "augmenter",
        predicatePushdown: "none",
        scanKind: "augmenter-overlay",
        trackedMcvValues: 0,
      });
    }
  }

  async storageStats(tagName?: string): Promise<LuaQueryCollection> {
    if (tagName === "") {
      throw new Error("Tag name is required");
    }

    const rows: StorageStatsRow[] = [];
    const tags = tagName === undefined ? this.allKnownTags() : [tagName];

    if (tagName === undefined) {
      const globalStorage = await this.computeIndexStorageStats();
      rows.push({
        scope: "global",
        tag: null,
        rowCount: null,
        bitmapBytes: globalStorage.bitmapBytes,
        metaBytes: globalStorage.metaBytes,
        dictionaryBytes: globalStorage.dictionaryBytes,
        objectBytes: globalStorage.objectBytes,
        indexBytes: globalStorage.indexBytes,
        totalBytes: globalStorage.totalBytes,
      });
    }

    for (const tag of tags) {
      const tagId = this.bitmapIndex.getDictionary().tryEncode(tag);
      const storage = await this.computeIndexStorageStats(tag);

      rows.push({
        scope: "tag",
        tag,
        rowCount: tagId === undefined ? 0 : this.bitmapIndex.getRowCount(tagId),
        bitmapBytes: storage.bitmapBytes,
        metaBytes: storage.metaBytes,
        dictionaryBytes: null,
        objectBytes: storage.objectBytes,
        indexBytes: storage.bitmapBytes + storage.metaBytes,
        totalBytes:
          storage.objectBytes + storage.bitmapBytes + storage.metaBytes,
      });
    }

    return new ArrayQueryCollection(rows);
  }

  contentPages(): LuaQueryCollection {
    return this.filteredTag(
      "page",
      (varName) =>
        `not table.find(${varName}.tags, function(tag) return tag == "meta" or string.startsWith(tag, "meta/") end)`,
    );
  }

  metaPages(): LuaQueryCollection {
    return this.filteredTag(
      "page",
      (varName) =>
        `table.find(${varName}.tags, function(tag) return tag == "meta" or string.startsWith(tag, "meta/") end)`,
    );
  }

  private filteredTag(
    tagName: string,
    buildFilterExpr: (varName: string) => string,
  ): LuaQueryCollection {
    const self = this;
    return {
      async query(
        query: LuaCollectionQuery,
        env: LuaEnv,
        sf: LuaStackFrame,
        config?: Config,
        instrumentation?: QueryInstrumentation,
      ): Promise<any[]> {
        await self.ensureAugmenterLoaded(tagName);

        const varName = query.objectVariable || "_";
        const filter = parseExpressionString(buildFilterExpr(varName));
        const where = query.where
          ? {
              type: "Binary" as const,
              operator: "and",
              left: filter,
              right: query.where,
              ctx: {},
            }
          : filter;

        const results: any[] = [];
        for await (const { value } of self.ds.query({
          prefix: [indexKey, tagName],
        })) {
          const decoded = self.bitmapIndex.decodeObject(value as EncodedObject);
          results.push(self.enrichValue(tagName, decoded));
        }
        return applyQuery(
          results,
          { ...query, where },
          env,
          sf,
          config,
          instrumentation,
        );
      },
    };
  }

  /**
   * Returns a queryable collection of all aggregate functions:
   *
   * - builtin,
   * - user-defined, and
   * - aliases.
   *
   * Every row has all columns: `builtin`, `name`, `description`,
   * `initialize`, `iterate`, `finish` and `target`.
   */
  aggregates(): LuaQueryCollection {
    const entries: Record<string, any>[] = [];

    // Builtins are always listed (even if overridden)
    for (const entry of getBuiltinAggregateEntries()) {
      entries.push({
        builtin: true,
        name: entry.name,
        description: entry.description,
        initialize: true,
        iterate: true,
        finish: entry.hasFinish,
        target: null,
      });
    }

    const userAggs: Record<string, any> = this.config.get("aggregates", {});
    for (const [key, spec] of Object.entries(userAggs)) {
      const aliasTarget =
        spec instanceof LuaTable ? spec.rawGet("alias") : (spec?.alias ?? null);
      if (typeof aliasTarget === "string") {
        const resolved = getAggregateSpec(aliasTarget, this.config);
        entries.push({
          builtin: false,
          name: key,
          description:
            spec instanceof LuaTable
              ? (spec.rawGet("description") ?? resolved?.description ?? "")
              : (spec?.description ?? resolved?.description ?? ""),
          initialize: resolved ? !!resolved.initialize : false,
          iterate: resolved ? !!resolved.iterate : false,
          finish: resolved ? !!resolved.finish : false,
          target: aliasTarget,
        });
      } else {
        let hasInit = false;
        let hasIter = false;
        let hasFin = false;
        let desc = "";
        if (spec instanceof LuaTable) {
          hasInit = !!spec.rawGet("initialize");
          hasIter = !!spec.rawGet("iterate");
          hasFin = !!spec.rawGet("finish");
          desc = spec.rawGet("description") ?? "";
        } else if (spec) {
          hasInit = !!spec.initialize;
          hasIter = !!spec.iterate;
          hasFin = !!spec.finish;
          desc = spec.description ?? "";
        }
        entries.push({
          builtin: false,
          name: key,
          description: desc,
          initialize: hasInit,
          iterate: hasIter,
          finish: hasFin,
          target: null,
        });
      }
    }
    return new ArrayQueryCollection(entries);
  }

  async getObjectByRef(
    page: string,
    tag: string,
    ref: string,
  ): Promise<any | null> {
    const refKey = this.cleanKey(ref, page);
    const objectId = await this.ds.get<number>([reverseKey, page, tag, refKey]);
    if (objectId === null || objectId === undefined) return null;

    const encoded = await this.ds.get<EncodedObject>([
      indexKey,
      tag,
      String(objectId),
    ]);
    if (!encoded) return null;
    return this.bitmapIndex.decodeObject(encoded);
  }

  async deleteObject(page: string, tag: string, ref: string): Promise<void> {
    const refKey = this.cleanKey(ref, page);
    const objectId = await this.ds.get<number>([reverseKey, page, tag, refKey]);
    if (objectId === null || objectId === undefined) return;

    const encoded = await this.ds.get<EncodedObject>([
      indexKey,
      tag,
      String(objectId),
    ]);

    if (encoded) {
      const tagId = this.bitmapIndex.getDictionary().tryEncode(tag);
      if (tagId !== undefined) {
        const meta = this.bitmapIndex.getTagMetaById(tagId);
        if (meta) {
          this.bitmapIndex.unindexObject(tagId, objectId, encoded, meta);
        }
      }
    }

    await this.ds.batchDelete([
      [indexKey, tag, String(objectId)],
      [reverseKey, page, tag, refKey],
    ]);
    await this.flushBitmapState();
  }

  public async indexObjects<T>(
    page: string,
    objects: ObjectValue<T>[],
  ): Promise<void> {
    const kvs = await this.processObjectsToKVs<T>(page, objects, false);
    if (kvs.length > 0) {
      await this.batchSet(page, kvs);
    }
  }

  public async validateObjects<T>(page: string, objects: ObjectValue<T>[]) {
    await this.processObjectsToKVs(page, objects, true);
  }

  queryLuaObjects<T>(
    globalEnv: LuaEnv,
    tag: string,
    query: LuaCollectionQuery,
    scopedVariables?: Record<string, any>,
  ): Promise<ObjectValue<T>[]> {
    const sf = LuaStackFrame.createWithGlobalEnv(globalEnv);
    let env = globalEnv;
    if (scopedVariables) {
      env = new LuaEnv(globalEnv);
      for (const [key, value] of Object.entries(scopedVariables)) {
        env.setLocal(key, jsToLuaValue(value));
      }
    }
    return this.tag(tag).query(query, env, sf) as Promise<ObjectValue<T>[]>;
  }

  private async batchSet(page: string, kvs: KV[]): Promise<void> {
    const writes: KV[] = [];
    const deletes: KvKey[] = [];

    if (this._freshMode) {
      // Fast path during full reindex: no existing objects, skip lookups
      for (const { key, value } of kvs) {
        const tag = key[0] as string;
        const refKey = key[1] as string;
        const encoded = this.bitmapIndex.encodeObject(
          value as Record<string, unknown>,
        );
        const { tagId, meta } = this.bitmapIndex.getTagMeta(tag);
        const objectId = this.bitmapIndex.allocateObjectId(tagId);
        this.bitmapIndex.indexObject(tagId, objectId, encoded, meta);

        writes.push({
          key: [indexKey, tag, String(objectId)],
          value: encoded,
        });
        writes.push({
          key: [reverseKey, page, tag, refKey],
          value: objectId,
        });
      }
    } else {
      // Normal path: look up existing objects, unindex old, index new

      // Phase 1: batch-read all reverse keys to find existing objectIds
      const reverseKeys: KvKey[] = kvs.map(({ key }) => [
        reverseKey,
        page,
        key[0] as string,
        key[1] as string,
      ]);
      const existingObjectIds = await this.ds.batchGet<number>(reverseKeys);

      // Phase 2: batch-read all existing encoded objects
      const encodedReadKeys: (KvKey | null)[] = existingObjectIds.map(
        (objId, i) => {
          if (objId !== null && objId !== undefined) {
            return [indexKey, kvs[i].key[0] as string, String(objId)];
          }
          return null;
        },
      );
      const nonNullEncodedKeys = encodedReadKeys.filter(
        (k): k is KvKey => k !== null,
      );
      const nonNullIndices: number[] = [];
      for (let i = 0; i < encodedReadKeys.length; i++) {
        if (encodedReadKeys[i] !== null) nonNullIndices.push(i);
      }
      const fetchedEncoded =
        nonNullEncodedKeys.length > 0
          ? await this.ds.batchGet<EncodedObject>(nonNullEncodedKeys)
          : [];

      const oldEncodedByIndex = new Map<number, EncodedObject>();
      for (let j = 0; j < nonNullIndices.length; j++) {
        const enc = fetchedEncoded[j];
        if (enc) {
          oldEncodedByIndex.set(nonNullIndices[j], enc);
        }
      }

      // Phase 3: process all objects
      for (let i = 0; i < kvs.length; i++) {
        const { key, value } = kvs[i];
        const tag = key[0] as string;
        const refKey = key[1] as string;
        const existingObjectId = existingObjectIds[i];

        // Unindex old object if it exists
        if (existingObjectId !== null && existingObjectId !== undefined) {
          const oldEncoded = oldEncodedByIndex.get(i);
          if (oldEncoded) {
            const tagId = this.bitmapIndex.getDictionary().tryEncode(tag);
            if (tagId !== undefined) {
              const meta = this.bitmapIndex.getTagMetaById(tagId);
              if (meta) {
                this.bitmapIndex.unindexObject(
                  tagId,
                  existingObjectId,
                  oldEncoded,
                  meta,
                );
              }
            }
          }
          deletes.push([indexKey, tag, String(existingObjectId)]);
        }

        // Encode and index new object
        const encoded = this.bitmapIndex.encodeObject(
          value as Record<string, unknown>,
        );
        const { tagId, meta } = this.bitmapIndex.getTagMeta(tag);
        const objectId =
          existingObjectId ?? this.bitmapIndex.allocateObjectId(tagId);

        if (existingObjectId !== null && existingObjectId !== undefined) {
          // allocateObjectId was not called, but unindex decremented count
          meta.count++;
        }

        this.bitmapIndex.indexObject(tagId, objectId, encoded, meta);

        writes.push({
          key: [indexKey, tag, String(objectId)],
          value: encoded,
        });
        writes.push({
          key: [reverseKey, page, tag, refKey],
          value: objectId,
        });
      }
    }

    const bitmapFlush = this.bitmapIndex.flushToKVs();
    writes.push(...bitmapFlush.writes);
    deletes.push(...bitmapFlush.deletes);

    if (deletes.length > 0) {
      await this.ds.batchDelete(deletes);
    }
    if (writes.length > 0) {
      await this.ds.batchSet(writes);
    }
  }

  private async flushBitmapState(): Promise<void> {
    const { writes, deletes } = this.bitmapIndex.flushToKVs();
    if (deletes.length > 0) {
      await this.ds.batchDelete(deletes);
    }
    if (writes.length > 0) {
      await this.ds.batchSet(writes);
    }
  }

  public async clearFileIndex(file: string): Promise<void> {
    const normalizedPage = this.normalizePageName(file);

    // Phase 1: Collect all reverse entries for this page
    const reverseEntries: { key: KvKey; tag: string; objectId: number }[] = [];
    for await (const { key, value } of this.ds.query<number>({
      prefix: [reverseKey, normalizedPage],
    })) {
      reverseEntries.push({
        key,
        tag: key[2] as string,
        objectId: value,
      });
    }

    if (reverseEntries.length === 0) return;

    // Phase 2: Batch-read all encoded objects at once (eliminates N+1)
    const encodedKeys: KvKey[] = reverseEntries.map(({ tag, objectId }) => [
      indexKey,
      tag,
      String(objectId),
    ]);
    const encodedObjects = await this.ds.batchGet<EncodedObject>(encodedKeys);

    // Phase 3: Unindex all objects from bitmaps
    const allDeletes: KvKey[] = [];
    for (let i = 0; i < reverseEntries.length; i++) {
      const { key, tag, objectId } = reverseEntries[i];
      const encoded = encodedObjects[i];

      if (encoded) {
        const tagId = this.bitmapIndex.getDictionary().tryEncode(tag);
        if (tagId !== undefined) {
          const meta = this.bitmapIndex.getTagMetaById(tagId);
          if (meta) {
            this.bitmapIndex.unindexObject(tagId, objectId, encoded, meta);
          }
        }
      }

      allDeletes.push(key);
      allDeletes.push([indexKey, tag, String(objectId)]);
    }

    await this.ds.batchDelete(allDeletes);
    await this.flushBitmapState();
  }

  public async clearIndex(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new AbortError();
    }
    this.bitmapIndex.clear();

    const prefixes: KvKey[] = [
      [indexKey],
      [reverseKey],
      ["b"],
      ["m"],
      ["$dict"],
      ["$indexStats"],
      ["$tagSketch"],
    ];

    const keyArrays = await Promise.all(
      prefixes.map(async (prefix) => {
        const keys: KvKey[] = [];
        for await (const { key } of this.ds.query({ prefix })) {
          keys.push(key);
        }
        return keys;
      }),
    );

    const allKeys = keyArrays.flat();
    if (allKeys.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < allKeys.length; i += CHUNK) {
        if (signal?.aborted) {
          throw new AbortError();
        }
        await this.ds.batchDelete(allKeys.slice(i, i + CHUNK));
      }
    }
    console.log("Deleted", allKeys.length, "keys from the index");
  }

  async ensureBootstrapIndexed(space: Space): Promise<void> {
    await this.runUnderSlot(async (signal) => {
      const state = await this.getIndexState();
      if (
        state &&
        state.schema === desiredIndexSchema &&
        state.pass1Complete
      ) {
        return;
      }
      await this.runFreshPass1(space, signal);
    });
  }

  async ensureFullIndex(space: Space): Promise<void> {
    await this.runUnderSlot(async (signal) => {
      const state = await this.getIndexState();

      const schemaOk = !!state && state.schema === desiredIndexSchema;

      if (schemaOk && state!.pass2Complete) {
        if (await this.isIndexCorrupt()) {
          console.warn(
            "[index]",
            "Index corruption detected (idx/ridx mismatch), forcing full reindex",
          );
          await this.runFreshPass1(space, signal);
          await this.runPass2(space, signal);
        }
        return;
      }

      if (!schemaOk || !state!.pass1Complete) {
        await this.runFreshPass1(space, signal);
      }
      await this.runPass2(space, signal);
    });
  }

  // Lightweight consistency check: for each known tag, the number of
  // idx rows in the KV store must equal the bitmap row count. A mismatch
  // means orphan idx rows exist (e.g. from a crash or a past bug) and
  // a full reindex is needed.
  private async isIndexCorrupt(): Promise<boolean> {
    for (const tagId of this.bitmapIndex.allTagIds()) {
      const tagName = this.bitmapIndex.getDictionary().decodeValue(tagId);
      if (typeof tagName !== "string") continue;

      const bitmapCount = this.bitmapIndex.getRowCount(tagId);

      let kvCount = 0;
      for await (const _entry of this.ds.query({
        prefix: [indexKey, tagName],
      })) {
        kvCount++;
        if (kvCount > bitmapCount) break;
      }

      if (kvCount !== bitmapCount) {
        console.warn(
          "[index]",
          `Tag "${tagName}": bitmap says ${bitmapCount} rows, KV has ${kvCount > bitmapCount ? `>${bitmapCount}` : kvCount} — corrupt`,
        );
        return true;
      }
    }
    return false;
  }

  async reindexSpace(space: Space): Promise<void> {
    if (this.currentReindex) {
      console.log("[index] Cancelling in-flight reindex for new request");
      this.currentReindex.controller.abort();
      try {
        await this.currentReindex.promise;
      } catch {
        // Aborted prior — expected
      }
    }
    await this.runUnderSlot(async (signal) => {
      await this.runFreshPass1(space, signal);
      await this.runPass2(space, signal);
    });
  }

  private async runUnderSlot(
    body: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    while (this.currentReindex) {
      try {
        await this.currentReindex.promise;
      } catch {
        // ignore prior errors
      }
    }
    const controller = new AbortController();
    const session = {
      controller,
      promise: body(controller.signal),
    };
    this.currentReindex = session;
    try {
      await session.promise;
    } finally {
      if (this.currentReindex === session) {
        this.currentReindex = undefined;
      }
    }
  }

  private async runFreshPass1(
    space: Space,
    signal: AbortSignal,
  ): Promise<void> {
    await this.markFullIndexInComplete();
    await this.mq.flushQueue("indexQueue");
    await this.mq.flushQueue("indexQueuePass1");
    if (signal.aborted) throw new AbortError();

    console.log("[index] Clearing index for Pass-1");
    await this.clearIndex(signal);

    const files = await space.deduplicatedFileList();
    if (signal.aborted) throw new AbortError();

    const mdFiles = files.filter((f) => f.name.endsWith(".md"));
    console.log(
      "[index] Pass-1: queueing",
      mdFiles.length,
      "markdown files (worker filters by space-lua/style fence)",
    );
    const startTime = Date.now();

    this._freshMode = true;
    try {
      await this.mq.batchSend(
        "indexQueuePass1",
        mdFiles.map((f) => f.name),
        signal,
      );
      await this.mq.awaitEmptyQueue("indexQueuePass1", signal);
    } finally {
      this._freshMode = false;
    }

    this.bitmapIndex.recomputeAllNDV();
    await this.flushBitmapState();

    await this.markPass1Complete();
    console.log(
      "[index] Pass-1 complete after",
      Date.now() - startTime,
      "ms",
    );
    await this.eventHook.dispatchEvent("editor:reloadState");
  }

  private async runPass2(space: Space, signal: AbortSignal): Promise<void> {
    await this.mq.flushQueue("indexQueue");
    if (signal.aborted) throw new AbortError();

    const files = await space.deduplicatedFileList();
    if (signal.aborted) throw new AbortError();

    console.log("[index] Pass-2: queueing", files.length, "files");
    const startTime = Date.now();

    await this.mq.batchSend(
      "indexQueue",
      files.map((f) => f.name),
      signal,
    );
    await this.mq.awaitEmptyQueue("indexQueue", signal);

    this.bitmapIndex.recomputeAllNDV();
    await this.flushBitmapState();

    await this.markFullIndexComplete();
    console.log(
      "[index] Pass-2 complete after",
      Date.now() - startTime,
      "ms",
    );
    await this.eventHook.dispatchEvent("editor:reloadState");
  }

  public async getIndexState(): Promise<IndexState | undefined> {
    const state = await this.ds.get<IndexState>(indexStateKey);
    if (state && typeof state === "object" && "schema" in state) {
      return state;
    }
    return undefined;
  }

  public async setIndexState(patch: Partial<IndexState>): Promise<IndexState> {
    const current = (await this.getIndexState()) ?? {
      schema: desiredIndexSchema,
      pass1Complete: false,
      pass2Complete: false,
    };
    const next: IndexState = { ...current, ...patch };
    await this.ds.set(indexStateKey, next);
    return next;
  }

  public async hasPass1Completed(): Promise<boolean> {
    const state = await this.getIndexState();
    return !!state &&
      state.schema === desiredIndexSchema &&
      state.pass1Complete;
  }

  public async hasFullIndexCompleted(): Promise<boolean> {
    const state = await this.getIndexState();
    return !!state &&
      state.schema === desiredIndexSchema &&
      state.pass2Complete;
  }

  async loadPersistedBitmapState(): Promise<void> {
    this.bitmapIndex.clear();

    const state = await this.getIndexState();
    if (!state || state.schema !== desiredIndexSchema) {
      return;
    }

    const dictSnapshot = await this.ds.get(["$dict"]);
    if (dictSnapshot) {
      this.bitmapIndex.loadDictionary(dictSnapshot);
    }

    for await (const { key, value } of this.ds.query({
      prefix: ["m"],
    })) {
      const tagId = Number(key[1]);
      if (Number.isFinite(tagId)) {
        this.bitmapIndex.loadTagMeta(tagId, value as any);
      }
    }

    for await (const { key, value } of this.ds.query<Uint8Array>({
      prefix: ["b"],
    })) {
      const tagId = Number(key[1]);
      const column = String(key[2]);
      const valueId = Number(key[3]);
      if (
        Number.isFinite(tagId) &&
        Number.isFinite(valueId) &&
        value instanceof Uint8Array
      ) {
        this.bitmapIndex.loadBitmap(tagId, column, valueId, value);
      }
    }
  }

  async awaitIndexQueueDrain(): Promise<void> {
    if (!(await this.hasFullIndexCompleted())) {
      return;
    }
    await this.mq.awaitEmptyQueue("indexQueue");
  }

  async markPass1Complete(): Promise<void> {
    await this.setIndexState({
      schema: desiredIndexSchema,
      pass1Complete: true,
    });
  }

  async markFullIndexComplete(): Promise<void> {
    await this.setIndexState({
      schema: desiredIndexSchema,
      pass1Complete: true,
      pass2Complete: true,
    });
  }

  async markFullIndexInComplete(): Promise<void> {
    await this.ds.delete(indexStateKey);
    await this.ds.delete(legacyIndexVersionKey);
  }

  private normalizePageName(page: string): string {
    return page.endsWith(".md") ? page.replace(/\.md$/, "") : page;
  }

  cleanKey(ref: string, page: string) {
    if (ref.startsWith(`${page}@`)) {
      return ref.substring(page.length + 1);
    } else {
      return ref;
    }
  }

  private async isBitmapPushdownTrusted(
    tagName: string,
    column: string,
  ): Promise<boolean> {
    const tagId = this.bitmapIndex.getDictionary().tryEncode(tagName);
    if (tagId === undefined) {
      return false;
    }

    const meta = this.bitmapIndex.getTagMetaById(tagId);
    if (!meta) {
      return false;
    }

    const columnMeta = meta.columns[column];
    if (!columnMeta?.indexed) {
      return false;
    }

    if (!(await this.hasFullIndexCompleted())) {
      return false;
    }
    if (!(await this.mq.isQueueEmpty("indexQueue"))) {
      return false;
    }

    return true;
  }

  async isTagIndexTrusted(tagName: string): Promise<boolean> {
    const tagId = this.bitmapIndex.getDictionary().tryEncode(tagName);
    if (tagId === undefined) {
      return false;
    }

    if (!(await this.hasFullIndexCompleted())) {
      return false;
    }
    if (!(await this.mq.isQueueEmpty("indexQueue"))) {
      return false;
    }

    return this.bitmapIndex.getTagMetaById(tagId) !== undefined;
  }

  /**
   * Resolve a set of augmenter cache keys (each key is the object's
   * `ref`) into bitmap object IDs for `tagName`.
   *
   * Augmenters are registered for tags whose `ref` is the storage page
   * itself (e.g. `page`, `document`), so the reverse-index entry lives
   * at `[reverseKey, page, tag, refKey]` with `page === refKey === ref`.
   * We exploit this with a direct `batchGet` rather than a linear scan.
   *
   * Refs not present in the reverse index (e.g. augmenter cache holds
   * a key that no longer corresponds to an indexed object) are silently
   * skipped, mirroring the bitmap path's tolerance for stale state.
   */
  async lookupObjectIdsByKeys(
    tagName: string,
    refs: ReadonlySet<string>,
  ): Promise<number[]> {
    if (refs.size === 0) return [];
    const refList = [...refs];
    const keys: KvKey[] = refList.map((ref) => [reverseKey, ref, tagName, ref]);
    const objectIds = await this.ds.batchGet<number>(keys);
    const out: number[] = [];
    for (const id of objectIds) {
      if (id !== null && id !== undefined) out.push(id);
    }
    return out;
  }

  /**
   * Enumerate every object ID for `tagName` by scanning the KV index.
   * Used by augmenter dispatch to materialise "universe" when a purely
   * `is-nil` augmenter predicate appears (since absent cache keys
   * trivially satisfy `col == nil`).
   *
   * O(N) over the tag's object count; only called on the augmenter
   * dispatch path when no other index can pre-narrow the universe.
   */
  async allObjectIdsForTag(tagName: string): Promise<number[]> {
    const tagId = this.bitmapIndex.getDictionary().tryEncode(tagName);
    if (tagId === undefined) return [];
    const out: number[] = [];
    for await (const { key } of this.ds.query({
      prefix: [indexKey, tagName],
    })) {
      const idStr = key[2];
      if (typeof idStr === "string") {
        const id = Number(idStr);
        if (Number.isFinite(id)) out.push(id);
      }
    }
    out.sort((a, b) => a - b);
    return out;
  }

  private async loadObjectsByObjectIds(
    tagName: string,
    objectIds: number[],
  ): Promise<ObjectValue<any>[]> {
    if (objectIds.length === 0) {
      return [];
    }

    const keys: KvKey[] = objectIds.map((id) => [
      indexKey,
      tagName,
      String(id),
    ]);
    const encodedObjects = await this.ds.batchGet<EncodedObject>(keys);

    const results: ObjectValue<any>[] = [];
    for (const encoded of encodedObjects) {
      if (!encoded) continue;
      const decoded = this.bitmapIndex.decodeObject(
        encoded,
      ) as ObjectValue<any>;
      results.push(this.enrichValue(tagName, decoded));
    }

    return results;
  }

  private async bitmapMatchMultiplePredicates(
    tagName: string,
    predicates: BitmapPredicate[],
  ): Promise<number[] | undefined> {
    if (predicates.length === 0) return undefined;

    // Check all columns are trusted for pushdown
    for (const pred of predicates) {
      if (!(await this.isBitmapPushdownTrusted(tagName, pred.column))) {
        return undefined;
      }
    }

    // Resolve each predicate to a RoaringBitmap, then AND them together
    let result: RoaringBitmap | undefined;

    for (const pred of predicates) {
      const bm = this.bitmapMatchSinglePredicate(tagName, pred);
      if (bm === undefined) {
        return undefined;
      }

      if (result === undefined) {
        result = bm;
      } else {
        result = RoaringBitmap.and(result, bm);
      }

      if (result.isEmpty()) {
        return [];
      }
    }

    return result ? result.toArray().sort((a, b) => a - b) : [];
  }

  private bitmapMatchSinglePredicate(
    tagName: string,
    predicate: BitmapPredicate,
  ): RoaringBitmap | undefined {
    const dict = this.bitmapIndex.getDictionary();
    const tagId = dict.tryEncode(tagName);
    if (tagId === undefined) {
      return new RoaringBitmap();
    }

    if (predicate.kind === "eq") {
      const valueId = dict.tryEncode(predicate.value);
      if (valueId === undefined) {
        return new RoaringBitmap();
      }
      const bm = this.bitmapIndex.getBitmap(tagId, predicate.column, valueId);
      return bm ?? new RoaringBitmap();
    }

    if (predicate.kind === "in") {
      let union: RoaringBitmap | undefined;
      for (const v of predicate.values) {
        const valueId = dict.tryEncode(v);
        if (valueId === undefined) {
          continue;
        }
        const bm = this.bitmapIndex.getBitmap(tagId, predicate.column, valueId);
        if (bm) {
          union = union ? RoaringBitmap.or(union, bm) : bm;
        }
      }
      return union ?? new RoaringBitmap();
    }

    if (predicate.kind === "neq") {
      const valueId = dict.tryEncode(predicate.value);
      if (valueId === undefined) {
        return undefined;
      }
      const allBitmaps = this.bitmapIndex.getColumnBitmaps(
        tagId,
        predicate.column,
      );
      if (allBitmaps.length === 0) {
        return undefined;
      }
      // OR all bitmaps for the column
      let union = allBitmaps[0];
      for (let i = 1; i < allBitmaps.length; i++) {
        union = RoaringBitmap.or(union, allBitmaps[i]);
      }
      // Remove the excluded value
      const excluded = this.bitmapIndex.getBitmap(
        tagId,
        predicate.column,
        valueId,
      );
      if (excluded) {
        union = RoaringBitmap.andNot(union, excluded);
      }
      return union;
    }

    // Range predicates: gt, gte, lt, lte
    const allValueIds = this.bitmapIndex.getColumnValueIds(
      tagId,
      predicate.column,
    );
    if (!allValueIds || allValueIds.length === 0) {
      return undefined;
    }

    // Filter value IDs by range condition, OR their bitmaps
    let union: RoaringBitmap | undefined;
    for (const vid of allValueIds) {
      const decoded = dict.decodeValue(vid);
      if (decoded === null || decoded === undefined) continue;
      if (
        typeof decoded === "string" ||
        typeof decoded === "number" ||
        typeof decoded === "boolean"
      ) {
        if (compareValues(decoded, predicate.value, predicate.kind)) {
          const bm = this.bitmapIndex.getBitmap(tagId, predicate.column, vid);
          if (bm) {
            union = union ? RoaringBitmap.or(union, bm) : bm;
          }
        }
      }
    }

    return union ?? new RoaringBitmap();
  }

  /**
   * Run the full indexing pipeline (validation, multi-tag expansion,
   * tag transforms) and return the resulting objects each paired with
   * the tag they're indexed under. Read-only: no DB writes.
   */
  public async previewProcessedObjects(
    page: string,
    objects: ObjectValue[],
  ): Promise<{ tag: string; object: ObjectValue }[]> {
    const kvs = await this.processObjectsToKVs(page, objects, false);
    return kvs.map((kv) => ({
      tag: kv.key[0],
      object: kv.value,
    }));
  }

  private async processObjectsToKVs<T>(
    page: string,
    objects: ObjectValue<T>[],
    throwOnValidationErrors: boolean,
  ): Promise<KV<T>[]> {
    const kvs: KV<T>[] = [];
    const tagDefinitions: Record<string, TagDefinition> = this.config.get(
      "tags",
      {},
    );
    // Taking this iteration approach as new objects may be pushed into this array on the fly
    while (objects.length > 0) {
      const obj = objects.shift()!;
      if (!obj.tag) {
        console.error("Object has no tag", obj, "this shouldn't happen");
        continue;
      }
      // Index as all the tag + any additional tags specified
      const allTags = [obj.tag, ...(obj.tags || [])];
      for (const tag of allTags) {
        const tagDefinition = tagDefinitions[tag];
        // Validate object based on schema if required
        if (
          tagDefinition?.schema &&
          (tagDefinition?.mustValidate || throwOnValidationErrors)
        ) {
          const validationError = validateObject(tagDefinition?.schema, obj);
          if (validationError) {
            if (!throwOnValidationErrors) {
              console.warn(
                `Object failed ${tag} validation so won't be indexed:`,
                obj,
                "Validation error:",
                validationError,
              );
              continue;
            } else {
              throw new ObjectValidationError(validationError, obj);
            }
          }
        }
        // Validate object based on validate callback if required
        if (
          tagDefinition?.validate &&
          (tagDefinition?.mustValidate || throwOnValidationErrors)
        ) {
          const validationError = await tagDefinition.validate(obj);
          if (validationError) {
            if (!throwOnValidationErrors) {
              console.warn(
                `Object failed ${tag} validation so won't be indexed:`,
                obj,
                "Validation error:",
                validationError,
              );
              continue;
            } else {
              throw new ObjectValidationError(validationError, obj);
            }
          }
        }
        if (tagDefinition?.transform) {
          let newObjects;
          try {
            newObjects = await tagDefinition.transform(obj);
          } catch (e: any) {
            throw new ObjectValidationError(e.message, obj);
          }

          if (!newObjects) {
            // null value returned, just index as usual
            kvs.push({
              key: [tag, this.cleanKey(obj.ref, page)],
              value: obj,
            });
            continue;
          }

          if (!Array.isArray(newObjects)) {
            // Probably returned single object, let's normalize
            newObjects = [newObjects];
          }
          // A transform function _must_ either return an empty list of
	  // objects to index, or return at least one object with the same ref.
          // If this doesn't happen, we may end up in an infinite loop.
          let foundAssignedRef = false;
          for (const newObj of newObjects) {
            if (!newObj.ref) {
              console.error(
                "transform result object did not contain ref",
                newObj,
              );
              continue;
            }
            if (newObj.ref === obj.ref) {
              kvs.push({
                key: [tag, this.cleanKey(newObj.ref, page)],
                value: newObj,
              });
              foundAssignedRef = true;
            } else {
              // Some other object
              objects.push(newObj);
            }
          }
          if (!foundAssignedRef && newObjects.length) {
            throw new Error(
              `transform() result objects for ${tag} did not contain result with original ref.`,
            );
          }
        } else {
          kvs.push({
            key: [tag, this.cleanKey(obj.ref, page)],
            value: obj,
          });
        }
      }
    }
    return kvs;
  }
}

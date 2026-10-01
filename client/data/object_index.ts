import type {
  IndexQueueBody,
  KV,
  KvKey,
} from "@silverbulletmd/silverbullet/type/datastore";
import type {
  FileMeta,
  ObjectValue,
} from "@silverbulletmd/silverbullet/type/index";
import { relationToLink } from "../../plugs/index/link.ts";
import type { Config } from "../config.ts";
import type { EventHook } from "../plugos/hooks/event.ts";
import { validateObject } from "../plugos/syscalls/jsonschema.ts";
import type { Space } from "../space.ts";
import {
  getAggregateSpec,
  getBuiltinAggregateEntries,
} from "../space_lua/aggregates.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import {
  applyQuery,
  ArrayQueryCollection,
  type LuaCollectionQuery,
  type LuaQueryCollection,
  matchesWhere,
} from "../space_lua/query_collection.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
} from "../space_lua/runtime.ts";
import type { DataStore } from "./datastore.ts";
import type { DataStoreMQ } from "./mq.datastore.ts";

const indexKey = "idx";
const pageKey = "ridx";

const indexVersionKey = ["$indexVersion"];

// Set while a full reindex is running and cleared on completion. Survives
// the version-key deletion a reindex performs at its start, so an
// `undefined` index version can be disambiguated: a fresh install has no
// marker, an interrupted reindex left one behind.
const reindexInProgressKey = ["$reindexInProgress"];

// Bump this one every time a full reindex is needed
const desiredIndexVersion = 14;

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

export class ObjectValidationError extends Error {
  constructor(
    message: string,
    readonly object: ObjectValue,
  ) {
    super(message);
  }
}

export class ObjectIndex {
  // True while a wholesale reindex (manual or version-bump) is running in
  // this window
  public rebuildInProgress = false;

  constructor(
    private ds: DataStore,
    private config: Config,
    private eventHook: EventHook,
    private mq: DataStoreMQ,
  ) {
    this.eventHook.addLocalListener("file:deleted", (path: string) => {
      return this.clearFileIndex(path);
    });

    // file:listed follows the change events that enqueue index work; both
    // listing and queue drain are needed to establish completion.
    let indexStarted = false;
    let finishInitialIndex: (() => Promise<void>) | undefined;
    // The queue announces a drain, not the state of being empty, so a client
    // that has already listed and drained gets no further event. Both signals
    // re-check the other rather than waiting for one that has been spent.
    const finishIfDrained = async () => {
      if (finishInitialIndex && (await this.mq.isQueueEmpty("indexQueue"))) {
        await finishInitialIndex();
      }
    };

    let lastFileList: FileMeta[] | undefined;
    this.eventHook.addLocalListener("file:listed", (allFiles: FileMeta[]) => {
      indexStarted = true;
      lastFileList = allFiles;
      return finishIfDrained();
    });

    void this.getCurrentIndexVersion().then((currentVersion) => {
      if (currentVersion === undefined) {
        const emptyQueueHandler = async () => {
          console.log("Index queue empty, checking if index is complete");
          // Theoretically we could get empty queue notifications before the file:listed event has been triggered, so let's account for this
          if (indexStarted) {
            await finishInitialIndex?.();
          }
        };
        // Guards against the two arming paths (a drained queue and a fresh
        // listing) overlapping and both acting on the same missing set.
        let finishing = false;
        let outstanding = Infinity;
        finishInitialIndex = async () => {
          if (finishing) {
            return;
          }
          finishing = true;
          try {
            // Queue drain alone cannot prove completeness after an interrupted boot.
            // Requeue missing files while the set shrinks, stopping if none make progress.
            const missingFiles = lastFileList
              ? await this.findUnindexedPages(lastFileList)
              : [];
            if (missingFiles.length > 0) {
              if (missingFiles.length < outstanding) {
                outstanding = missingFiles.length;
                console.warn(
                  "[index]",
                  `Initial index is missing ${missingFiles.length} page(s), queueing them`,
                );
                await this.mq.batchSend(
                  "indexQueue",
                  missingFiles.map((path): IndexQueueBody => ({ path })),
                );
                // Still armed: the drain after these index re-runs this check
                return;
              }
              console.warn(
                "[index]",
                `Giving up on ${missingFiles.length} page(s) that never indexed`,
              );
            }
            finishInitialIndex = undefined;
            console.info("Initial index complete, reloading editor state");
            await this.markFullIndexComplete();
            this.eventHook.removeLocalListener(
              "mq:emptyQueue:indexQueue",
              emptyQueueHandler,
            );
            void this.eventHook.dispatchEvent("editor:reloadState");
          } finally {
            finishing = false;
          }
        };
        this.eventHook.addLocalListener(
          "mq:emptyQueue:indexQueue",
          emptyQueueHandler,
        );
        if (indexStarted) {
          void finishIfDrained();
        }
      }
    });
  }

  private enricher(key: KvKey, value: any): any {
    const tag = key[1];
    const mt = this.config.get<LuaTable | undefined>(
      ["tags", tag, "metatable"],
      undefined,
    );
    if (!mt) {
      return value;
    }
    value = jsToLuaValue(value);
    value.metatable = mt;
    return value;
  }

  /**
   * Returns a LuaQueryCollection representation of all objects with a specific tag
   * @param tagName name of the tag
   */
  objectsWithTag(tagName: string): LuaQueryCollection {
    if (!tagName) {
      throw new Error("Tag name is required");
    }
    if (tagName === "link") {
      // Special handling of deprecated "link" (virtual collection implementation)
      return this.linkObjects();
    }
    return {
      query: (query, env, sf, config?): Promise<any[]> => {
        return this.memoLuaQuery(
          tagName,
          query,
          env,
          sf,
          (key, value) => this.enricher(key, value),
          config,
        );
      },
    };
  }

  /**
   * Virtual `link` collection for backwards compatibility: scans `relation` records, projecting each
   * into the legacy `link` shape via `relationToLink`.
   */
  linkObjects(): LuaQueryCollection {
    return {
      query: (query, env, sf, config?): Promise<any[]> => {
        return this.memoLuaQuery(
          "relation",
          query,
          env,
          sf,
          (key, value) => {
            const link = relationToLink(value);
            if (!link) return undefined;
            return this.enricher(key, link);
          },
          config,
        );
      },
    };
  }

  contentPages(tagName?: string): LuaQueryCollection {
    const notMeta = (varName: string) =>
      `not table.find(${varName}.tags, function(tag) return tag == "meta" or string.startsWith(tag, "meta/") end)`;
    if (tagName) {
      return this.filteredTag(
        tagName,
        (varName) => `${varName}.tag == "page" and ${notMeta(varName)}`,
      );
    }
    return this.filteredTag("page", notMeta);
  }

  metaPages(): LuaQueryCollection {
    return this.filteredTag(
      "page",
      (varName) =>
        `table.find(${varName}.tags, function(tag) return tag == "meta" or string.startsWith(tag, "meta/") end)`,
    );
  }

  aspiringPages(): LuaQueryCollection {
    return this.objectsWithTag("aspiring-page");
  }

  ambiguousLinks(): LuaQueryCollection {
    return this.objectsWithTag("ambiguous-link");
  }

  relations(kind?: string): LuaQueryCollection {
    if (kind) {
      // `kind` isn't part of the key, so this still scans every relation --
      // but rejecting in the enricher skips both enrichment and the Lua
      // predicate for the rows that don't match, and never materializes them.
      return {
        query: (query, env, sf, config?): Promise<any[]> => {
          return this.memoLuaQuery(
            "relation",
            query,
            env,
            sf,
            (key, value) =>
              value?.kind === kind ? this.enricher(key, value) : undefined,
            config,
          );
        },
      };
    }
    return this.objectsWithTag("relation");
  }

  rootTaggedObjects(rootTag: string, tag?: string): LuaQueryCollection {
    if (tag) {
      return this.filteredTag(
        tag,
        (varName) => `${varName}.tag == "${rootTag}"`,
      );
    } else {
      return this.objectsWithTag(rootTag);
    }
  }

  subPages(pageName: string): LuaQueryCollection {
    const prefix = JSON.stringify(`${pageName}/`);
    return this.filteredTag(
      "page",
      (varName) => `string.startsWith(${varName}.name, ${prefix})`,
    );
  }

  private filteredTag(
    tagName: string,
    buildFilterExpr: (varName: string) => string,
  ): LuaQueryCollection {
    return {
      query: (query, env, sf, config?): Promise<any[]> => {
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
        return this.memoLuaQuery(
          tagName,
          { ...query, where },
          env,
          sf,
          (key, value) => this.enricher(key, value),
          config,
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

  async getObjectByRef(page: string, tag: string, ref: string) {
    if (tag === "link") {
      // Look up the corresponding relation and project it. Relation
      // refs are bare `page@pos`, matching what virtual link records
      // expose, so the lookup key transfers as-is.
      const rel = await this.ds.get([
        indexKey,
        "relation",
        this.cleanKey(ref, page),
        page,
      ]);
      return rel ? relationToLink(rel) : undefined;
    }
    return this.ds.get([indexKey, tag, this.cleanKey(ref, page), page]);
  }

  private reindexingForVersionBump = false;

  async ensureFullIndex(space: Space) {
    const currentIndexVersion = await this.getCurrentIndexVersion();

    if (
      currentIndexVersion !== undefined &&
      currentIndexVersion >= desiredIndexVersion
    ) {
      return;
    }

    // A fresh install has no version and indexes lazily. An interrupted reindex
    // also has no version, but its marker requires resuming the rebuild.
    if (
      currentIndexVersion === undefined &&
      !(await this.isReindexInProgress())
    ) {
      console.log("No index version found, assuming fresh install");
      return;
    }

    // Guard against concurrent invocations (e.g. one from
    // `space-sync-complete` and another from a follow-up `server-version`
    // SW message) — only one version-bump reindex should run at a time.
    if (this.reindexingForVersionBump) {
      return;
    }
    this.reindexingForVersionBump = true;
    try {
      // Wait out any indexing currently in flight (e.g. just-synced files
      // being indexed) so we don't fight the worker over the queue.
      await this.mq.awaitEmptyQueue("indexQueue");

      // Serialize the reindex across every open window/tab: the whole
      // space lives in a single shared IndexedDB object store, and two
      // windows clearing + rewriting it concurrently serialize on that
      // one store and can wedge each other (one window's `get` blocks
      // forever behind the other's bulk delete).
      await this.withLock(async () => {
        // Re-read the version now that we hold the lock — another window
        // (or a concurrent path here) may have already completed the bump
        // while we were queued behind it.
        const versionNow = await this.getCurrentIndexVersion();
        if (versionNow !== undefined && versionNow >= desiredIndexVersion) {
          return;
        }

        console.info(
          "[index]",
          "Performing a full space reindex, this could take a while...",
          currentIndexVersion,
          desiredIndexVersion,
        );

        await this.reindexSpaceUnlocked(space);

        void this.eventHook.dispatchEvent("editor:reloadState");
      });
    } finally {
      this.reindexingForVersionBump = false;
    }
  }

  /**
   * Full space reindex. Public entry point (used by the manual
   * "Space: Reindex" command and the `index.reindexSpace` syscall) — takes
   * the cross-window lock so it can't race a concurrent reindex (auto or
   * manual) running in another window. The auto path (`ensureFullIndex`)
   * already holds the lock, so it calls `reindexSpaceUnlocked` directly to
   * avoid re-entering the (non-reentrant) lock and deadlocking on itself.
   */
  reindexSpace(space: Space): Promise<void> {
    return this.withLock(() => this.reindexSpaceUnlocked(space));
  }

  private async reindexSpaceUnlocked(space: Space) {
    // In-memory mirror for the UI: the boot progress label shows during any
    // wholesale rebuild, and `fullIndexCompleted` never flips back to false
    // after a first boot.
    this.rebuildInProgress = true;
    try {
      // Record that a reindex is underway *before* we delete the version key,
      // so an interruption between here and `markFullIndexComplete` is
      // recoverable (see `ensureFullIndex`).
      await this.markReindexInProgress();
      console.log("Clearing page index...");
      await this.clearIndex();
      await this.markFullIndexInComplete();

      const files = await space.deduplicatedFileList();

      console.log("Queing", files.length, "pages to be indexed.");
      const startTime = Date.now();
      await this.mq.batchSend(
        "indexQueue",
        // `clearIndex` above already dropped every file's entries, so tell the
        // indexer not to clear them again one file at a time.
        files.map(
          (file): IndexQueueBody => ({ path: file.name, cleared: true }),
        ),
      );
      await this.mq.awaitEmptyQueue("indexQueue");
      await this.markFullIndexComplete();
      console.log("Full index completed after", Date.now() - startTime, "ms");
    } finally {
      this.rebuildInProgress = false;
    }
  }

  /**
   * Cross-window mutual exclusion for global reindex work.
   */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = (navigator as any)?.locks;
    if (!locks?.request) {
      return fn();
    }
    const dbName = (this.ds.kv as any).dbName ?? "default";
    return locks.request(`sb-reindex:${dbName}`, fn);
  }

  public async hasFullIndexCompleted() {
    return (await this.ds.get(indexVersionKey)) >= desiredIndexVersion;
  }

  public getCurrentIndexVersion(): Promise<number | undefined> {
    return this.ds.get(indexVersionKey) as Promise<number | undefined>;
  }

  /**
   * True once any full indexing pass has ever completed for this
   * space, regardless of whether the stored version matches the current
   * `desiredIndexVersion`.
   */
  public async isIndexAvailable(): Promise<boolean> {
    return (await this.getCurrentIndexVersion()) !== undefined;
  }

  async awaitIndexQueueDrain(): Promise<void> {
    await this.mq.awaitEmptyQueue("indexQueue");
  }

  /**
   * Markdown files from `files` that have no `page` object in the index.
   */
  private async findUnindexedPages(files: FileMeta[]): Promise<string[]> {
    const indexedPages = new Set<string>();
    for await (const { key } of this.ds.query({ prefix: [indexKey, "page"] })) {
      indexedPages.add(String(key[key.length - 1]));
    }
    const missing: string[] = [];
    for (const file of files) {
      if (
        file.name.endsWith(".md") &&
        !indexedPages.has(file.name.slice(0, -3))
      ) {
        missing.push(file.name);
      }
    }
    return missing;
  }

  async markFullIndexComplete() {
    await this.ds.set(indexVersionKey, desiredIndexVersion);
    await this.ds.delete(reindexInProgressKey);
  }

  async markFullIndexInComplete() {
    await this.ds.delete(indexVersionKey);
  }

  private markReindexInProgress(): Promise<void> {
    return this.ds.set(reindexInProgressKey, true);
  }

  private async isReindexInProgress(): Promise<boolean> {
    return (await this.ds.get(reindexInProgressKey)) === true;
  }

  cleanKey(ref: string, page: string) {
    if (ref.startsWith(`${page}@`)) {
      return ref.substring(page.length + 1);
    } else {
      return ref;
    }
  }

  /**
   * How long a memoized full-tag scan stays valid. Same-window index writes
   * invalidate immediately; the TTL bounds staleness from writes made by
   * another window/tab sharing the IndexedDB.
   */
  scanMemoTTLMs = 5000;
  private scanMemo = new Map<string, { rows: KV[]; at: number }>();
  private scanInFlight = new Map<string, Promise<KV[]>>();
  // Bumped on every invalidation, so a scan that was already running when a
  // write landed doesn't memoize what it read before the write.
  private scanGenerations = new Map<string, number>();
  private allScansGeneration = 0;

  private scanGeneration(tag: string): string {
    return `${this.allScansGeneration}:${this.scanGenerations.get(tag) ?? 0}`;
  }

  /** Without `tags`, drops every tag's memo. */
  private invalidateScanMemo(tags?: Iterable<string>) {
    if (!tags) {
      this.allScansGeneration++;
      this.scanMemo.clear();
      this.scanInFlight.clear();
      return;
    }
    for (const tag of tags) {
      this.scanGenerations.set(tag, (this.scanGenerations.get(tag) ?? 0) + 1);
      this.scanMemo.delete(tag);
      this.scanInFlight.delete(tag);
    }
  }

  /** Invalidates on both sides of the write: a scan starting while it is in
   * flight may or may not see it. */
  private async writeInvalidating(
    tags: Set<string>,
    write: () => Promise<void>,
  ): Promise<void> {
    this.invalidateScanMemo(tags);
    try {
      await write();
    } finally {
      this.invalidateScanMemo(tags);
    }
  }

  /**
   * Materializes the full `["idx", tag]` range, memoized. During boot the
   * page list, widgets, and script loading all scan the same ranges within
   * a few hundred ms — one walk serves them all.
   */
  private scanTagRawRows(tag: string): Promise<KV[]> {
    const memo = this.scanMemo.get(tag);
    if (memo && performance.now() - memo.at < this.scanMemoTTLMs) {
      return Promise.resolve(memo.rows);
    }
    const inFlight = this.scanInFlight.get(tag);
    if (inFlight) {
      return inFlight;
    }
    const generation = this.scanGeneration(tag);
    const scan = (async () => {
      const rows: KV[] = [];
      for await (const row of this.ds.query({ prefix: [indexKey, tag] })) {
        rows.push(row);
      }
      if (this.scanGeneration(tag) === generation) {
        this.scanMemo.set(tag, { rows, at: performance.now() });
      }
      return rows;
    })();
    this.scanInFlight.set(tag, scan);
    return scan.finally(() => {
      if (this.scanInFlight.get(tag) === scan) {
        this.scanInFlight.delete(tag);
      }
    });
  }

  /**
   * Drop-in equivalent of `ds.luaQuery(["idx", tag], ...)` backed by the
   * memoized scan. Values are cloned per caller so consumers can mutate
   * results freely, exactly as they can with the structured clones IndexedDB
   * hands out. Only rows that pass `where` are cloned: the filter reads the
   * memoized values themselves, which must stay unmodified.
   */
  private async memoLuaQuery<T>(
    tag: string,
    query: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
    enricher?: (key: KvKey, item: any) => any,
    config?: Config,
  ): Promise<T[]> {
    const rawRows = await this.scanTagRawRows(tag);
    const materialize = (key: KvKey, value: any) => {
      const item = structuredClone(value);
      return enricher ? enricher(key, item) : item;
    };
    const results: any[] = [];
    for (const { key, value } of rawRows) {
      if (query.where) {
        const probe = enricher ? enricher(key, value) : value;
        if (probe === undefined) continue;
        if (!(await matchesWhere(probe, query, env, sf))) continue;
      }
      const item = materialize(key, value);
      if (item !== undefined) results.push(item);
    }
    return applyQuery(
      results,
      query.where ? { ...query, where: undefined } : query,
      env,
      sf,
      config,
    );
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
    if (tag === "link") {
      return this.linkObjects().query(query, env, sf) as Promise<
        ObjectValue<T>[]
      >;
    }
    return this.memoLuaQuery(tag, query, env, sf);
  }

  batchSet(page: string, kvs: KV[]): Promise<void> {
    const finalBatch: KV[] = [];
    for (const { key, value } of kvs) {
      finalBatch.push(
        {
          key: [indexKey, ...key, page],
          value,
        },
        {
          // Reverse key storage for quick deletions
          key: [pageKey, page, ...key],
          value: true,
        },
      );
    }
    return this.writeInvalidating(tagsOf(kvs.map((kv) => kv.key)), () =>
      this.ds.batchSet(finalBatch),
    );
  }

  batchDelete(page: string, keys: KvKey[]): Promise<void> {
    const finalBatch: KvKey[] = [];
    for (const key of keys) {
      finalBatch.push([indexKey, ...key, page]);
    }
    return this.writeInvalidating(tagsOf(keys), () =>
      this.ds.batchDelete(finalBatch),
    );
  }

  /**
   * Clears all keys for a given file
   * @param file
   */
  public async clearFileIndex(file: string): Promise<void> {
    if (file.endsWith(".md")) {
      file = file.replace(/\.md$/, "");
    }
    const allKeys: KvKey[] = [];
    const indexKeys: KvKey[] = [];
    for await (const { key } of this.ds.query({
      prefix: [pageKey, file],
    })) {
      allKeys.push(key);
      allKeys.push([indexKey, ...key.slice(2), file]);
      indexKeys.push(key.slice(2));
    }
    await this.writeInvalidating(tagsOf(indexKeys), () =>
      this.ds.batchDelete(allKeys),
    );
  }

  /**
   * Returns distinct user-defined tag names — i.e. hashtags declared on pages,
   * tasks or items, plus frontmatter tags. Built-in object types
   * (`page`, `task`, `item`, …) are implicit and not listed here.
   */
  public async tagNames(): Promise<string[]> {
    const names = new Set<string>();
    for await (const entry of this.ds.query({ prefix: [indexKey, "tag"] })) {
      const value = entry.value as { name?: unknown } | undefined;
      if (value && typeof value.name === "string") names.add(value.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Clears the entire index
   */
  public async clearIndex(): Promise<void> {
    this.invalidateScanMemo();
    const allKeys: KvKey[] = [];
    for await (const { key } of this.ds.query({ prefix: [indexKey] })) {
      allKeys.push(key);
    }
    for await (const { key } of this.ds.query({ prefix: [pageKey] })) {
      allKeys.push(key);
    }
    const deleteChunkSize = 500;
    for (let i = 0; i < allKeys.length; i += deleteChunkSize) {
      await this.ds.batchDelete(allKeys.slice(i, i + deleteChunkSize));
    }
    console.log("Deleted", allKeys.length, "keys from the index");
  }

  /**
   * Indexes entities in the data store
   */
  public async indexObjects<T>(
    page: string,
    objects: ObjectValue<T>[],
  ): Promise<void> {
    const kvs = await this.processObjectsToKVs<T>(page, objects, false);
    if (kvs.length > 0) {
      return this.batchSet(page, kvs);
    } else {
      return Promise.resolve();
    }
  }

  /**
   * Validate and transform objects, throws a ValidationError when it fails
   * @param page
   * @param objects
   * @throw ValidationError
   */
  public async validateObjects<T>(page: string, objects: ObjectValue<T>[]) {
    await this.processObjectsToKVs(page, objects, true);
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
      // Run validations and transforms first, tracking the final value
      // (transforms may mutate the obj in place, or return a fresh object
      // with the same ref). Only after all tag iterations finish do we
      // emit kvs — so tags without a transform write the same final state
      // as tags with one, instead of an earlier snapshot.
      let current: ObjectValue<T> = obj;
      const tagsToWrite: string[] = [];
      const allTags = [obj.tag, ...(obj.tags || [])];
      for (const tag of allTags) {
        const tagDefinition = tagDefinitions[tag];
        if (
          tagDefinition?.schema &&
          (tagDefinition?.mustValidate || throwOnValidationErrors)
        ) {
          const validationError = validateObject(
            tagDefinition?.schema,
            current,
          );
          if (validationError) {
            if (!throwOnValidationErrors) {
              console.warn(
                `Object failed ${tag} validation so won't be indexed:`,
                current,
                "Validation error:",
                validationError,
              );
              continue;
            } else {
              throw new ObjectValidationError(validationError, current);
            }
          }
        }
        if (
          tagDefinition?.validate &&
          (tagDefinition?.mustValidate || throwOnValidationErrors)
        ) {
          const validationError = await tagDefinition.validate(current);
          if (validationError) {
            if (!throwOnValidationErrors) {
              console.warn(
                `Object failed ${tag} validation so won't be indexed:`,
                current,
                "Validation error:",
                validationError,
              );
              continue;
            } else {
              throw new ObjectValidationError(validationError, current);
            }
          }
        }
        if (tagDefinition?.transform) {
          let newObjects;
          try {
            newObjects = await tagDefinition.transform(current);
          } catch (e: any) {
            throw new ObjectValidationError(e.message, current);
          }

          if (!newObjects) {
            tagsToWrite.push(tag);
            continue;
          }

          if (!Array.isArray(newObjects)) {
            newObjects = [newObjects];
          }
          // A transform function _must_ either return an empty list of objects to index, or return at least one object with the same ref
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
            if (newObj.ref === current.ref) {
              // Same-ref result: adopt as the new current value so subsequent
              // transforms (and the final kv writes) see the transformed state.
              current = newObj;
              foundAssignedRef = true;
            } else {
              objects.push(newObj);
            }
          }
          if (!foundAssignedRef && newObjects.length) {
            throw new Error(
              `transform() result objects for ${tag} did not contain result with original ref.`,
            );
          }
          tagsToWrite.push(tag);
        } else {
          tagsToWrite.push(tag);
        }
      }
      const refKey = this.cleanKey(current.ref, page);
      for (const tag of tagsToWrite) {
        kvs.push({
          key: [tag, refKey],
          value: current,
        });
      }
    }
    return kvs;
  }

  deleteObject(page: string, tag: string, ref: string): Promise<void> {
    return this.batchDelete(page, [[tag, this.cleanKey(ref, page)]]);
  }
}

/** The tags a set of `[tag, ...]` index keys write to. */
function tagsOf(keys: KvKey[]): Set<string> {
  return new Set(keys.map((key) => String(key[0])));
}

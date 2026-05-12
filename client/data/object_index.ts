import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { Config } from "../config.ts";
import {
  ArrayQueryCollection,
  type LuaCollectionQuery,
  type LuaQueryCollection,
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
import type { DataStoreMQ } from "./mq.datastore.ts";
import type { Space } from "../space.ts";
import { validateObject } from "../plugos/syscalls/jsonschema.ts";
import {
  getAggregateSpec,
  getBuiltinAggregateEntries,
} from "../space_lua/aggregates.ts";

const indexKey = "idx";
const pageKey = "ridx";

const indexVersionKey = ["$indexVersion"];

// Bump this one every time a full reindex is needed
const desiredIndexVersion = 9;

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
  constructor(
    private ds: DataStore,
    private config: Config,
    private eventHook: EventHook,
    private mq: DataStoreMQ,
  ) {
    // Clear any entries for deleted files
    this.eventHook.addLocalListener("file:deleted", (path: string) => {
      return this.clearFileIndex(path);
    });

    // Tracks if the file:listed event has been triggered,
    // which is fired after all file:changed events have been dispatched
    // resulting in new index entries (if any) being queued in the index queue
    // this is later used to track if the index is complete
    let indexStarted = false;
    this.eventHook.addLocalListener("file:listed", () => {
      indexStarted = true;
    });

    // Handle initial index completion
    void this.hasFullIndexCompleted().then((hasCompleted) => {
      if (!hasCompleted) {
        const emptyQueueHandler = async () => {
          console.log("Index queue empty, checking if index is complete");
          // Theoretically we could get empty queue notifications before the file:listed event has been triggered, so let's account for this
          if (indexStarted) {
            // Indexing has just finished for the first time for this client
            console.info("Initial index complete, reloading editor state");
            await this.markFullIndexComplete();
            // Unsubscribe yourself
            this.eventHook.removeLocalListener(
              "mq:emptyQueue:indexQueue",
              emptyQueueHandler,
            );
            // Trigger an editor:reloadState event to reload the editor state (render widgets etc.)
            void this.eventHook.dispatchEvent("editor:reloadState");
          }
        };
        this.eventHook.addLocalListener(
          "mq:emptyQueue:indexQueue",
          emptyQueueHandler,
        );
      }
    });
  }

  private enricher(key: KvKey, value: any): any {
    const tag = key[1];
    // See if we have a meta table defined, which we'll then slap on
    const mt = this.config.get<LuaTable | undefined>(
      ["tags", tag, "metatable"],
      undefined,
    );
    if (!mt) {
      // Return as is
      return value;
    }
    // Convert to LuaTable
    value = jsToLuaValue(value);
    value.metatable = mt;
    return value;
  }

  tag(tagName: string): LuaQueryCollection {
    if (!tagName) {
      throw new Error("Tag name is required");
    }
    return {
      query: (query, env, sf, config?): Promise<any[]> => {
        return this.ds.luaQuery(
          ["idx", tagName],
          query,
          env,
          sf,
          (key, value) => this.enricher(key, value),
          config,
        );
      },
    };
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
        return this.ds.luaQuery(
          ["idx", tagName],
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

    // Config entries (user-defined overrides and aliases)
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

  getObjectByRef(page: string, tag: string, ref: string) {
    return this.ds.get([indexKey, tag, this.cleanKey(ref, page), page]);
  }

  async ensureFullIndex(space: Space) {
    const currentIndexVersion = await this.getCurrentIndexVersion();

    if (!currentIndexVersion) {
      console.log("No index version found, assuming fresh install");
      return;
    }

    if (
      // If the index version is less than the desired version
      currentIndexVersion < desiredIndexVersion &&
      // And the index queue is empty (meaning no indexing is ongoing)
      (await this.mq.isQueueEmpty("indexQueue"))
    ) {
      console.info(
        "[index]",
        "Performing a full space reindex, this could take a while...",
        currentIndexVersion,
        desiredIndexVersion,
      );

      await this.reindexSpace(space);

      // Dispatch an editor:reloadState event to reload the editor state (render widgets etc.)
      void this.eventHook.dispatchEvent("editor:reloadState");
    }
  }

  async reindexSpace(space: Space) {
    console.log("Clearing page index...");
    await this.clearIndex();
    await this.markFullIndexInComplete();

    const files = await space.deduplicatedFileList();

    console.log("Queing", files.length, "pages to be indexed.");
    // Queue all file names to be indexed
    const startTime = Date.now();
    await this.mq.batchSend(
      "indexQueue",
      files.map((file) => file.name),
    );
    await this.mq.awaitEmptyQueue("indexQueue");
    await this.markFullIndexComplete();
    console.log("Full index completed after", Date.now() - startTime, "ms");
  }

  public async hasFullIndexCompleted() {
    return (await this.ds.get(indexVersionKey)) >= desiredIndexVersion;
  }

  private getCurrentIndexVersion() {
    return this.ds.get(indexVersionKey);
  }

  async awaitIndexQueueDrain(): Promise<void> {
    await this.mq.awaitEmptyQueue("indexQueue");
  }

  async markFullIndexComplete() {
    await this.ds.set(indexVersionKey, desiredIndexVersion);
  }

  async markFullIndexInComplete() {
    await this.ds.delete(indexVersionKey);
  }

  cleanKey(ref: string, page: string) {
    if (ref.startsWith(`${page}@`)) {
      return ref.substring(page.length + 1);
    } else {
      return ref;
    }
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
    return this.ds.luaQuery([indexKey, tag], query, env, sf);
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
          key: [pageKey, page, ...key],
          value: true,
        },
      );
    }
    return this.ds.batchSet(finalBatch);
  }

  batchDelete(page: string, keys: KvKey[]): Promise<void> {
    const finalBatch: KvKey[] = [];
    for (const key of keys) {
      finalBatch.push([indexKey, ...key, page]);
    }
    return this.ds.batchDelete(finalBatch);
  }

  /**
   * Clears all keys for a given file
   * @param file
   */
  public async clearFileIndex(file: string): Promise<void> {
    if (file.endsWith(".md")) {
      file = file.replace(/\.md$/, "");
    }
    // console.log("Clearing index for", file);
    const allKeys: KvKey[] = [];
    for await (const { key } of this.ds.query({
      prefix: [pageKey, file],
    })) {
      allKeys.push(key);
      allKeys.push([indexKey, ...key.slice(2), file]);
    }
    await this.ds.batchDelete(allKeys);
  }

  /**
   * Clears the entire index
   */
  public async clearIndex(): Promise<void> {
    const allKeys: KvKey[] = [];
    for await (const { key } of this.ds.query({ prefix: [indexKey] })) {
      allKeys.push(key);
    }
    for await (const { key } of this.ds.query({ prefix: [pageKey] })) {
      allKeys.push(key);
    }
    await this.ds.batchDelete(allKeys);
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
        // Validate object based on schema if required
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
        // Validate object based on validate callback if required
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
        // Transform object
        if (tagDefinition?.transform) {
          let newObjects;
          try {
            newObjects = await tagDefinition.transform(current);
          } catch (e: any) {
            throw new ObjectValidationError(e.message, current);
          }

          if (!newObjects) {
            // null value returned, just index as usual
            tagsToWrite.push(tag);
            continue;
          }

          if (!Array.isArray(newObjects)) {
            // Probably returned single object, let's normalize
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
              // Some other object — needs its own processing pass
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
      // Emit kvs with the final transformed value so every tag's row shares
      // the same post-transform state.
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

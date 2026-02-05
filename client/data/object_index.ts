import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { Config } from "../config.ts";
import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "../space_lua/query_collection.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  type LuaTable,
} from "../space_lua/runtime.ts";
import type { DataStore } from "./datastore.ts";
import type { KV, KvKey } from "@silverbulletmd/silverbullet/type/datastore";
import type { EventHook } from "../plugos/hooks/event.ts";
import type { DataStoreMQ } from "./mq.datastore.ts";
import type { Space } from "../space.ts";
import { validateObject } from "../plugos/syscalls/jsonschema.ts";

const indexKey = "idx";
const pageKey = "ridx";

const indexVersionKey = ["$indexVersion"];
const indexQueuedKey = ["$indexQueued"];

// Bump this one every time a full reindex is needed
const desiredIndexVersion = 9;

type TagDefinition = {
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
  constructor(message: string, readonly object: ObjectValue) {
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
    let startTime = -1;
    this.eventHook.addLocalListener("file:initial", async () => {
      startTime = Date.now();
      await this.setIndexOngoing(true);
    });

    this.eventHook.addLocalListener("file:deleted", async (path: string) => {
      await this.clearFileIndex(path);
    });

    const emptyQueueHandler = async () => {
      await this.setIndexOngoing(false);
      if (
        startTime !== -1 && !await this.hasInitialIndexCompleted()
      ) {
        // Indexing has just finished for the first time
        console.info(
          "Initial index complete after",
          (Date.now() - startTime) / 1000,
          "s",
        );
        // Unsubscribe myself
        this.eventHook.removeLocalListener(
          "mq:emptyQueue:indexQueue",
          emptyQueueHandler,
        );
        await this.markInitialIndexComplete();
        this.eventHook.dispatchEvent("editor:reloadState");
      }
    };
    this.eventHook.addLocalListener(
      "mq:emptyQueue:indexQueue",
      emptyQueueHandler,
    );
  }

  tag(tagName: string): LuaQueryCollection {
    if (!tagName) {
      throw new Error("Tag name is required");
    }
    return {
      query: (
        query: LuaCollectionQuery,
        env: LuaEnv,
        sf: LuaStackFrame,
      ): Promise<any[]> => {
        return this.ds.luaQuery(
          ["idx", tagName],
          query,
          env,
          sf,
          (key, value: any) => {
            const tag = key[1];
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
          },
        );
      },
    };
  }

  getObjectByRef<T>(page: string, tag: string, ref: string) {
    return this.ds.get([indexKey, tag, this.cleanKey(ref, page), page]);
  }

  async isIndexOngoing() {
    return !!(await this.ds.get(indexQueuedKey));
  }

  async setIndexOngoing(val: boolean = true) {
    await this.ds.set(indexQueuedKey, val);
  }

  async ensureFullIndex(space: Space) {
    // Commenting out this check because I think it always holds when calling this API
    // if (!this.client.fullSyncCompleted) {
    //   console.info(
    //     "Initial full sync not completed, skipping index check",
    //   );
    //   return;
    // }
    const currentIndexVersion = await this.getCurrentIndexVersion();

    if (!currentIndexVersion) {
      console.log("No index version found, assuming fresh install");
      return;
    }

    if (
      currentIndexVersion < desiredIndexVersion &&
      !await this.isIndexOngoing()
    ) {
      console.info(
        "[index]",
        "Performing a full space reindex, this could take a while...",
        currentIndexVersion,
        desiredIndexVersion,
      );
      await this.setIndexOngoing(true);
      await this.reindexSpace(space);
      console.info("[index]", "Full space index complete.");
      await this.markInitialIndexComplete();
      await this.setIndexOngoing(false);
      // Let's load space scripts again, which probably weren't loaded before
      this.eventHook.dispatchEvent("editor:reloadState");
    }
  }

  async reindexSpace(space: Space) {
    console.log("Clearing page index...");
    await this.clearIndex();

    const files = await space.deduplicatedFileList();

    console.log("Queing", files.length, "pages to be indexed.");
    // Queue all file names to be indexed
    const startTime = Date.now();
    await this.mq.batchSend("indexQueue", files.map((file) => file.name));
    await this.mq.awaitEmptyQueue("indexQueue");
    console.log("Done with full index after", Date.now() - startTime, "ms");
  }

  public async hasInitialIndexCompleted() {
    return (await this.ds.get(indexVersionKey)) >= desiredIndexVersion;
  }

  private getCurrentIndexVersion() {
    return this.ds.get(indexVersionKey);
  }

  async markInitialIndexComplete() {
    await this.ds.set(indexVersionKey, desiredIndexVersion);
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
    const sf = LuaStackFrame.createWithGlobalEnv(
      globalEnv,
    );
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
      finalBatch.push({
        key: [indexKey, ...key, page],
        value,
      }, {
        key: [pageKey, page, ...key],
        value: true,
      });
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
    for await (
      const { key } of this.ds.query({
        prefix: [pageKey, file],
      })
    ) {
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
    for await (
      const { key } of this.ds.query({ prefix: [indexKey] })
    ) {
      allKeys.push(key);
    }
    for await (
      const { key } of this.ds.query({ prefix: [pageKey] })
    ) {
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
      const allTags = [obj.tag, ...obj.tags || []];
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
        // Transform object
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
            if (newObj.ref === obj.ref) {
              // Got the same object back here, let's just index it without further processing
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
          // Just insert it directly
          kvs.push({
            key: [tag, this.cleanKey(obj.ref, page)],
            value: obj,
          });
        }
      }
    }
    return kvs;
  }

  deleteObject(
    page: string,
    tag: string,
    ref: string,
  ): Promise<void> {
    return this.batchDelete(page, [[tag, this.cleanKey(ref, page)]]);
  }
}

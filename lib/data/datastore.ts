import { applyQueryNoFilterKV } from "../../plug-api/lib/query.ts";
import type {
  FunctionMap,
  KV,
  KvKey,
  KvQuery,
  QueryExpression,
} from "../../plug-api/types.ts";
import { builtinFunctions } from "../builtin_query_functions.ts";
import type { KvPrimitives } from "./kv_primitives.ts";
import { evalQueryExpression } from "../../plug-api/lib/query_expression.ts";
/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  constructor(
    readonly kv: KvPrimitives,
    public functionMap: FunctionMap = builtinFunctions,
    public objectEnrichers: ObjectEnricher[] = [],
  ) {
  }

  async get<T = any>(key: KvKey): Promise<T | null> {
    return (await this.batchGet([key]))[0];
  }

  async batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]> {
    if (keys.length === 0) {
      return [];
    }
    const results = await this.kv.batchGet(keys);

    // Enrich the objects based on object enrichers
    for (const entry of results) {
      this.enrichObject(entry);
    }
    return results;
  }

  set(key: KvKey, value: any): Promise<void> {
    return this.batchSet([{ key, value }]);
  }

  batchSet<T = any>(entries: KV<T>[]): Promise<void> {
    if (entries.length === 0) {
      return Promise.resolve();
    }
    const allKeyStrings = new Set<string>();
    const uniqueEntries: KV[] = [];
    for (const { key, value } of entries) {
      const keyString = JSON.stringify(key);
      if (allKeyStrings.has(keyString)) {
        console.warn(`Duplicate key ${keyString} in batchSet, skipping`);
      } else {
        allKeyStrings.add(keyString);
        this.cleanEnrichedObject(value);
        uniqueEntries.push({ key, value });
      }
    }
    return this.kv.batchSet(uniqueEntries);
  }

  delete(key: KvKey): Promise<void> {
    return this.batchDelete([key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    if (keys.length === 0) {
      return Promise.resolve();
    }
    return this.kv.batchDelete(keys);
  }

  async query<T = any>(
    query: KvQuery,
    variables: Record<string, any> = {},
  ): Promise<KV<T>[]> {
    const results: KV<T>[] = [];
    let itemCount = 0;
    // Accumulate results
    let limit = Infinity;
    if (query.limit) {
      limit = await evalQueryExpression(
        query.limit,
        {},
        variables,
        this.functionMap,
      );
    }
    for await (
      const entry of this.kv.query(query)
    ) {
      // Enrich
      this.enrichObject(entry.value);
      // Filter
      if (
        query.filter &&
        !await evalQueryExpression(
          query.filter,
          entry.value,
          variables,
          this.functionMap,
        )
      ) {
        continue;
      }
      results.push(entry);
      itemCount++;
      // Stop when the limit has been reached
      if (itemCount === limit && !query.orderBy) {
        // Only break when not also ordering in which case we need all results
        break;
      }
    }
    // Apply order by, limit, and select
    return applyQueryNoFilterKV(
      query,
      results,
      variables,
      this.functionMap,
    );
  }

  async queryDelete(
    query: KvQuery,
    variables: Record<string, any> = {},
  ): Promise<void> {
    const keys: KvKey[] = [];
    for (
      const { key } of await this.query(query, variables)
    ) {
      keys.push(key);
    }
    return this.batchDelete(keys);
  }

  /**
   * Enriches the object with the attributes defined in the object enrichers on the fly.
   * Will add a `$dynamicAttributes` array to the object to keep track of the dynamic attributes set (for cleanup)
   * @param object
   * @returns
   */
  enrichObject(object: any) {
    // Check if this object looks like an object value
    if (!object || typeof object !== "object") {
      // Skip
      return;
    }

    for (const enricher of this.objectEnrichers) {
      const whereEvalResult = evalQueryExpression(
        enricher.where,
        object,
        {}, // We will not support variables in enrichers for now
        this.functionMap,
      );
      if (whereEvalResult instanceof Promise) {
        // For performance reasons we can only allow synchronous where clauses
        throw new Error(
          `Enricher where clause cannot be an async function: ${enricher.where}`,
        );
      }
      if (
        whereEvalResult
      ) {
        // The `where` matches so we should enrich this object
        for (
          const [attributeSelector, expression] of Object.entries(
            enricher.attributes,
          )
        ) {
          // Recursively travel to the attribute based on the selector, which may contain .'s to go deeper
          let objectValue = object;
          const selectorParts = attributeSelector.split(".");
          for (const part of selectorParts.slice(0, -1)) {
            if (typeof objectValue[part] !== "object") {
              // Pre-create the object if it doesn't exist
              objectValue[part] = {};
            }
            objectValue = objectValue[part];
          }

          const value = evalQueryExpression(
            expression,
            object,
            {},
            this.functionMap,
          );
          if (value instanceof Promise) {
            // For performance reasons we can only allow synchronous expressions
            throw new Error(
              `Enricher dynamic attribute expression cannot be an async function: ${expression}`,
            );
          }
          const lastPart = selectorParts[selectorParts.length - 1];
          if (objectValue[lastPart] !== undefined) {
            // The attribute already exists, we should merge the values if we can, or ignore the new value
            if (Array.isArray(objectValue[lastPart]) && Array.isArray(value)) {
              // If the attribute already exists and is an array, we should merge the arrays
              objectValue[lastPart] = [...objectValue[lastPart], ...value];
            } else {
              // We can't merge the values, so we just ignore the new value
            }
          } else { // New attribute
            objectValue[lastPart] = value;
            if (!object.$dynamicAttributes) {
              object.$dynamicAttributes = [];
            }
            object.$dynamicAttributes.push(attributeSelector);
          }
        }
      }
    }
  }

  /**
   * Reverses the enriching of the object with the attributes defined in objectEnrichers
   * @param object
   * @returns
   */
  cleanEnrichedObject(object: any) {
    // Check if this is an enriched object
    if (!object || !object.$dynamicAttributes) {
      // Skip
      return;
    }

    for (const attributeSelector of object.$dynamicAttributes) {
      // Recursively travel to the attribute based on the selector, which may contain .'s to go deeper
      let objectValue = object;
      const selectorParts = attributeSelector.split(".");
      for (const part of selectorParts.slice(0, -1)) {
        if (typeof objectValue[part] !== "object") {
          // This shouldn't happen, but let's back out
          break;
        }
        objectValue = objectValue[part];
      }

      delete objectValue[selectorParts[selectorParts.length - 1]];
    }
    // Clean up empty objects, this is somewhat questionable, because it also means that if the user intentionally kept empty objects in there, these will be wiped
    cleanupEmptyObjects(object);
    delete object.$dynamicAttributes;
  }
}

export type ObjectEnricher = {
  // If this expression evaluates to true for the given object
  where: QueryExpression;
  // Dynamically add these attributes to the object, can use "." syntax for deeper attribute definition
  attributes: Record<string, QueryExpression>;
};

/**
 * Recursively removes empty objects from the object
 * @param object
 */
export function cleanupEmptyObjects(object: any) {
  for (const key in object) {
    // Skip arrays
    if (Array.isArray(object[key])) {
      continue;
    }
    if (typeof object[key] === "object") {
      cleanupEmptyObjects(object[key]);
      if (Object.keys(object[key]).length === 0) {
        delete object[key];
      }
    }
  }
}

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
import { string } from "zod";
import { deepObjectMerge } from "$sb/lib/json.ts";
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
  enrichObject(object: any): any {
    // Check if this object looks like an object value
    if (!object || typeof object !== "object") {
      // Skip
      return object;
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
        object = this.enrichValue(object, object, enricher.attributes);
      }
    }
    return object;
  }

  private enrichValue(
    rootValue: any,
    currentValue: any,
    attributeDefinition: QueryExpression | DynamicAttributeDefinitions,
  ): any {
    if (attributeDefinition === undefined) {
      return currentValue;
    } else if (Array.isArray(attributeDefinition)) {
      // This is QueryExpression, so we're in a leaf node, let's evaluate it and return
      const evalResult = evalQueryExpression(
        attributeDefinition as QueryExpression,
        rootValue,
        {},
        this.functionMap,
      );
      if (evalResult instanceof Promise) {
        // For performance reasons we can only allow synchronous where clauses
        throw new Error(
          `Enricher where clause cannot be an async function: ${attributeDefinition}`,
        );
      }
      return evalResult;
    } else {
      // If this is an object, we need to recursively enrich the object
      if (!currentValue) {
        // Define an empty object if the value is undefined
        currentValue = {};
      }
      // Make a shallo copy of the object
      const enrichedObject: any = { ...currentValue };
      // Then iterate over all the dynamic attribute definitions
      for (
        const [key, subAttributeDefinition] of Object.entries(
          attributeDefinition,
        )
      ) {
        const enrichedValue = this.enrichValue(
          rootValue,
          {},
          subAttributeDefinition,
        );
        if (enrichedObject[key] === undefined) {
          if (!enrichedObject.$dynamicAttributes) {
            enrichedObject.$dynamicAttributes = [];
          }
          if (!enrichedObject.$dynamicAttributes.includes(key)) {
            enrichedObject.$dynamicAttributes.push(key);
          }
          enrichedObject[key] = enrichedValue;
        } else if (Array.isArray(enrichedValue)) {
          // Let's merge the arrays
          if (!Array.isArray(enrichedObject[key])) {
            throw new Error(`Cannot enrich array with non-array value: ${key}`);
          }
          enrichedObject[key] = [...enrichedObject[key], ...enrichedValue];
        } else {
          enrichedObject[key] = deepObjectMerge(
            enrichedValue,
            currentValue[key],
            true,
          );
        }
      }
      return enrichedObject;
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

    // Clean out the dynamic attributes
    for (const attribute of object.$dynamicAttributes) {
      delete object[attribute];
    }
    delete object.$dynamicAttributes;

    // Recursively clean up the object
    for (const value of Object.values(object)) {
      if (typeof value === "object") {
        this.cleanEnrichedObject(value);
      }
    }
    // Clean up empty objects, this is somewhat questionable, because it also means that if the user intentionally kept empty objects in there, these will be wiped
    // cleanupEmptyObjects(object);
  }
}

export type ObjectEnricher = {
  // If this expression evaluates to true for the given object
  where: QueryExpression;
  // Dynamically add these attributes to the object, can use "." syntax for deeper attribute definition
  attributes: DynamicAttributeDefinitions;
};

interface DynamicAttributeDefinitions {
  [key: string]: QueryExpression | DynamicAttributeDefinitions;
}

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

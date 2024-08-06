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
import { deepObjectMerge } from "@silverbulletmd/silverbullet/lib/json";
/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  constructor(
    readonly kv: KvPrimitives,
    public functionMap: FunctionMap = builtinFunctions,
    public objectDecorators: ObjectDecorators[] = [],
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

    for (const enricher of this.objectDecorators) {
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

  /**
   * Enriches the object with the attributes defined in the object enrichers on the fly.
   * @param rootValue
   * @param currentValue
   * @param attributeDefinition
   * @returns
   */
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
      // This is a nested attribute definition, we need to recursively traverse it
      if (!currentValue) {
        // Define an empty object if the value is undefined
        currentValue = {};
      }
      // Then iterate over all the dynamic attribute definitions
      for (
        const [key, subAttributeDefinition] of Object.entries(
          attributeDefinition,
        )
      ) {
        // Recurse and see what we get back
        const enrichedValue = this.enrichValue(
          rootValue,
          {},
          subAttributeDefinition,
        );
        // If there's no value set yet, just set it directly
        if (currentValue[key] === undefined) {
          // Track $dynamicAttributes that we set for later cleanup before persisting
          if (!currentValue.$dynamicAttributes) {
            currentValue.$dynamicAttributes = new Set<string>();
          }
          currentValue.$dynamicAttributes.add(key);

          // Set the value
          currentValue[key] = enrichedValue;
        } else if (Array.isArray(enrichedValue)) {
          // If the value is an array, we need to merge it
          if (!Array.isArray(currentValue[key])) {
            throw new Error(`Cannot enrich array with non-array value: ${key}`);
          }
          currentValue[key] = [...currentValue[key], ...enrichedValue];
        } else {
          currentValue[key] = deepObjectMerge(
            enrichedValue,
            currentValue[key],
            true,
          );
        }
      }
      return currentValue;
    }
  }

  /**
   * Reverses the enriching of the object with the attributes defined in objectEnrichers
   * @param object
   * @returns nothing, modifies the object in place
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
  }
}

export type ObjectDecorators = {
  // If this expression evaluates to true for the given object
  where: QueryExpression;
  // Dynamically add these attributes to the object, can use "." syntax for deeper attribute definition
  attributes: DynamicAttributeDefinitions;
};

export interface DynamicAttributeDefinitions {
  [key: string]: QueryExpression | DynamicAttributeDefinitions;
}

import { datastore, system } from "@silverbulletmd/silverbullet/syscalls";
import type {
  KV,
  KvKey,
  KvQuery,
  ObjectQuery,
  ObjectValue,
} from "../../plug-api/types.ts";
import type { QueryProviderEvent } from "../../plug-api/types.ts";
import { determineType, type SimpleJSONType } from "./attributes.ts";
import { ttlCache } from "$lib/memory_cache.ts";
import type { LuaCollectionQuery } from "$common/space_lua/query_collection.ts";

const indexKey = "idx";
const pageKey = "ridx";

/*
 * Key namespace:
 * [indexKey, type, ...key, page] -> value
 * [pageKey, page, ...key] -> true // for fast page clearing
 * ["type", type] -> true // for fast type listing
 */

export function batchSet(page: string, kvs: KV[]): Promise<void> {
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
  return datastore.batchSet(finalBatch);
}

/**
 * Clears all keys for a given file
 * @param file
 */
export async function clearFileIndex(file: string): Promise<void> {
  if (file.endsWith(".md")) {
    file = file.replace(/\.md$/, "");
  }
  const allKeys: KvKey[] = [];
  for (
    const { key } of await datastore.query({
      prefix: [pageKey, file],
    })
  ) {
    allKeys.push(key);
    allKeys.push([indexKey, ...key.slice(2), file]);
  }
  await datastore.batchDel(allKeys);
}

/**
 * Clears the entire index
 */
export async function clearIndex(): Promise<void> {
  const allKeys: KvKey[] = [];
  for (
    const { key } of await datastore.query({ prefix: [indexKey] })
  ) {
    allKeys.push(key);
  }
  for (
    const { key } of await datastore.query({ prefix: [pageKey] })
  ) {
    allKeys.push(key);
  }
  await datastore.batchDel(allKeys);
  console.log("Deleted", allKeys.length, "keys from the index");
}

// OBJECTS API

/**
 * Indexes entities in the data store
 */
export async function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  const kvs: KV<T>[] = [];
  const schema = await system.getSpaceConfig("schema");
  const allAttributes = new Map<string, SimpleJSONType>();
  for (const obj of objects) {
    if (!obj.tag) {
      console.error("Object has no tag", obj, "this shouldn't happen");
      continue;
    }
    // Index as all the tag + any additional tags specified
    const allTags = [obj.tag, ...obj.tags || []];
    const tagSchemaProperties =
      schema.tag[obj.tag] && schema.tag[obj.tag].properties || {};
    for (const tag of allTags) {
      // The object itself
      kvs.push({
        key: [tag, cleanKey(obj.ref, page)],
        value: obj,
      });
      // Index attributes
      const schemaAttributes = schema.tag[tag] && schema.tag[tag].properties;
      if (!schemaAttributes) {
        // There is no schema definition for this tag, so we index all attributes
        for (
          const [attrName, attrValue] of Object.entries(
            obj as Record<string, any>,
          )
        ) {
          if (attrName.startsWith("$") || tagSchemaProperties[attrName]) {
            continue;
          }

          allAttributes.set(`${tag}:${attrName}`, determineType(attrValue));
        }
      } else {
        // For tags with schemas, only index attributes that are not in the schema
        for (
          const [attrName, attrValue] of Object.entries(
            obj as Record<string, any>,
          )
        ) {
          // Skip schema-defined and internal attributes
          if (
            schemaAttributes[attrName] || tagSchemaProperties[attrName] ||
            attrName.startsWith("$")
          ) {
            continue;
          }
          allAttributes.set(`${tag}:${attrName}`, determineType(attrValue));
        }
      }
    }
  }
  if (allAttributes.size > 0) {
    [...allAttributes].forEach(([key, value]) => {
      const [tagName, name] = key.split(":");
      kvs.push({
        key: ["ah-attr", cleanKey(key, page)],
        value: {
          ref: key,
          tag: "ah-attr",
          tagName,
          name,
          page,
          schema: value,
        } as T,
      });
    });
  }
  if (kvs.length > 0) {
    return batchSet(page, kvs);
  } else {
    return Promise.resolve();
  }
}

function cleanKey(ref: string, page: string) {
  if (ref.startsWith(`${page}@`)) {
    return ref.substring(page.length + 1);
  } else {
    return ref;
  }
}

export function queryObjects<T>(
  tag: string,
  query: ObjectQuery,
  ttlSecs?: number,
): Promise<ObjectValue<T>[]> {
  return ttlCache(query, async () => {
    return (await datastore.query({
      ...query,
      prefix: [indexKey, tag],
      distinct: true,
    })).map(({ value }) => value);
  }, ttlSecs);
}

export function queryLuaObjects<T>(
  tag: string,
  query: LuaCollectionQuery,
  scopedVariables: Record<string, any> = {},
  ttlSecs?: number,
): Promise<ObjectValue<T>[]> {
  return ttlCache(query, () => {
    return datastore.queryLua([indexKey, tag], query, scopedVariables);
  }, ttlSecs);
}

export function queryDeleteObjects<T>(
  tag: string,
  query: ObjectQuery,
): Promise<void> {
  return datastore.queryDelete({
    ...query,
    prefix: [indexKey, tag],
  });
}

export async function query(
  query: KvQuery,
  variables?: Record<string, any>,
): Promise<KV[]> {
  return (await datastore.query({
    ...query,
    prefix: [indexKey, ...query.prefix ? query.prefix : []],
  }, variables)).map(({ key, value }) => ({ key: key.slice(1), value }));
}

export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<ObjectValue<T> | undefined> {
  return datastore.get([indexKey, tag, cleanKey(ref, page), page]);
}

export async function objectSourceProvider({
  query,
  variables,
}: QueryProviderEvent): Promise<any[]> {
  const tag = query.querySource!;
  const results = await datastore.query({
    ...query,
    prefix: [indexKey, tag],
    distinct: true,
  }, variables);
  return results.map((r) => r.value);
}

export async function discoverSources() {
  const schema = await system.getSpaceConfig("schema");
  // Query all tags we indexed
  return (await datastore.query({
    prefix: [indexKey, "tag"],
    select: [{ name: "name" }],
    distinct: true,
  })).map((
    { value },
  ) => value.name)
    // And concatenate all the tags from the schema
    .concat(Object.keys(schema.tag));
}

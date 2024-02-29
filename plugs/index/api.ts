import { datastore } from "$sb/syscalls.ts";
import {
  KV,
  KvKey,
  KvQuery,
  ObjectQuery,
  ObjectValue,
} from "../../plug-api/types.ts";
import { QueryProviderEvent } from "../../plug-api/types.ts";
import { builtins } from "./builtins.ts";
import { determineType } from "./attributes.ts";
import { ttlCache } from "$lib/memory_cache.ts";

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
 * Clears all keys for a given page
 * @param page
 */
export async function clearPageIndex(page: string): Promise<void> {
  const allKeys: KvKey[] = [];
  for (
    const { key } of await datastore.query({
      prefix: [pageKey, page],
    })
  ) {
    allKeys.push(key);
    allKeys.push([indexKey, ...key.slice(2), page]);
  }
  await datastore.batchDel(allKeys);
}

/**
 * Clears the entire page index
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
export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  const kvs: KV<T>[] = [];
  const allAttributes = new Map<string, string>(); // tag:name -> attributeType
  for (const obj of objects) {
    if (!obj.tag) {
      console.error("Object has no tag", obj, "this shouldn't happen");
      continue;
    }
    // Index as all the tag + any additional tags specified
    const allTags = [obj.tag, ...obj.tags || []];
    for (const tag of allTags) {
      // The object itself
      kvs.push({
        key: [tag, cleanKey(obj.ref, page)],
        value: obj,
      });
      // Index attributes
      const builtinAttributes = builtins[tag];
      if (!builtinAttributes) {
        // This is not a builtin tag, so we index all attributes (almost, see below)
        attributeLabel: for (
          const [attrName, attrValue] of Object.entries(
            obj as Record<string, any>,
          )
        ) {
          if (attrName.startsWith("$")) {
            continue;
          }
          // Check for all tags attached to this object if they're builtins
          // If so: if `attrName` is defined in the builtin, use the attributeType from there (mostly to preserve readOnly aspects)
          for (const otherTag of allTags) {
            const builtinAttributes = builtins[otherTag];
            if (builtinAttributes && builtinAttributes[attrName]) {
              allAttributes.set(
                `${tag}:${attrName}`,
                builtinAttributes[attrName],
              );
              continue attributeLabel;
            }
          }
          allAttributes.set(`${tag}:${attrName}`, determineType(attrValue));
        }
      } else if (tag !== "attribute") {
        // For builtin tags, only index custom ones
        for (
          const [attrName, attrValue] of Object.entries(
            obj as Record<string, any>,
          )
        ) {
          // console.log("Indexing", tag, attrName, attrValue);
          // Skip builtins and internal attributes
          if (builtinAttributes[attrName] || attrName.startsWith("$")) {
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
      const attributeType = value.startsWith("!") ? value.substring(1) : value;
      kvs.push({
        key: ["attribute", cleanKey(key, page)],
        value: {
          ref: key,
          tag: "attribute",
          tagName,
          name,
          attributeType,
          readOnly: value.startsWith("!"),
          page,
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
  return (await datastore.query({
    prefix: [indexKey, "tag"],
    select: [{ name: "name" }],
    distinct: true,
  })).map((
    { value },
  ) => value.name);
}

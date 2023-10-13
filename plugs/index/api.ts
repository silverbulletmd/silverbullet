import { datastore } from "$sb/syscalls.ts";
import { KV, KvKey, KvQuery, ObjectQuery, ObjectValue } from "$sb/types.ts";
import { QueryProviderEvent } from "$sb/app_event.ts";
import { builtins } from "./builtins.ts";
import { AttributeObject, determineType } from "./attributes.ts";

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
 * Clears the entire datastore for this indexKey plug
 */
export async function clearIndex(): Promise<void> {
  const allKeys: KvKey[] = [];
  for (
    const { key } of await datastore.query({ prefix: [] })
  ) {
    allKeys.push(key);
  }
  await datastore.batchDel(allKeys);
  console.log("Deleted", allKeys.length, "keys from the index");
}

// ENTITIES API

/**
 * Indexes entities in the data store
 */
export async function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  const kvs: KV<T>[] = [];
  const allAttributes = new Map<string, string>(); // tag:name -> attributeType
  for (const obj of objects) {
    for (const tag of obj.tags) {
      kvs.push({
        key: [tag, cleanKey(obj.ref, page)],
        value: obj,
      });
      // Index attributes
      const builtinAttributes = builtins[tag];
      if (!builtinAttributes) {
        // For non-builtin tags, index all attributes
        for (
          const [attrName, attrValue] of Object.entries(
            obj as Record<string, any>,
          )
        ) {
          if (attrName.startsWith("$")) {
            continue;
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
    await indexObjects<AttributeObject>(
      page,
      [...allAttributes].map(([key, value]) => {
        const [tag, name] = key.split(":");
        return {
          ref: key,
          tags: ["attribute"],
          tag,
          name,
          attributeType: value,
          page,
        };
      }),
    );
  }
  return batchSet(page, kvs);
}

function cleanKey(ref: string, page: string) {
  if (ref.startsWith(`${page}@`)) {
    return ref.substring(page.length + 1);
  } else {
    return ref;
  }
}

export async function queryObjects<T>(
  tag: string,
  query: ObjectQuery,
): Promise<ObjectValue<T>[]> {
  return (await datastore.query({
    ...query,
    prefix: [indexKey, tag],
    distinct: true,
  })).map(({ value }) => value);
}

export async function query(
  query: KvQuery,
): Promise<KV[]> {
  return (await datastore.query({
    ...query,
    prefix: [indexKey, ...query.prefix ? query.prefix : []],
  })).map(({ key, value }) => ({ key: key.slice(1), value }));
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
}: QueryProviderEvent): Promise<any[]> {
  const tag = query.querySource!;
  const results = await datastore.query({
    ...query,
    prefix: [indexKey, tag],
    distinct: true,
  });
  return results.map((r) => r.value);
}

export async function discoverSources() {
  return (await datastore.query({ prefix: [indexKey, "tag"] })).map((
    { value },
  ) => value.name);
}

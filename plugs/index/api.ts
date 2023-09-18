import { datastore } from "$sb/syscalls.ts";
import { AttributeObject, KV, KvKey, KvQuery, ObjectValue } from "$sb/types.ts";
import { QueryProviderEvent } from "$sb/app_event.ts";
import { builtinPseudoPage, builtins } from "./builtins.ts";
import { determineType } from "./attributes.ts";

/*
 * Key namespace:
 * ["index", type, ...key, page] -> value
 * ["page", page, ...key] -> true // for fast page clearing
 * ["type", type] -> true // for fast type listing
 */

export function batchSet(page: string, kvs: KV[]): Promise<void> {
  const finalBatch: KV[] = [];
  for (const { key, value } of kvs) {
    finalBatch.push({
      key: ["index", ...key, page],
      value,
    }, {
      key: ["page", page, ...key],
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
      prefix: ["page", page],
    })
  ) {
    allKeys.push(key);
    allKeys.push(["index", ...key.slice(2), page]);
  }
  await datastore.batchDel(allKeys);
}

/**
 * Clears the entire datastore for this "index" plug
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
  for (const { key, value, tags } of objects) {
    for (const tag of tags) {
      kvs.push({
        key: [tag, ...key, page],
        value,
      });
      // Index attributes
      if (!builtins[tag]) {
        // But only for non-builtin tags
        for (
          const [attrName, attrValue] of Object.entries(
            value as Record<string, any>,
          )
        ) {
          if (attrName.startsWith("$")) {
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
          key: [tag, name],
          tags: ["attribute"],
          value: {
            tag,
            name,
            attributeType: value,
            page,
          },
        };
      }),
    );
  }
  return batchSet(page, kvs);
}

// export async function indexAttributes(
//   page: string,
//   attributes: AttributeObject[],
// ) {
//   const setAttributes = new Set<string>();
//   const filteredAttributes = attributes.filter((attr) => {
//     const key = `${attr.tag}:${attr.name}`;
//     // Remove duplicates, that's ok
//     if (setAttributes.has(key)) {
//       return false;
//     }
//     setAttributes.add(key);
//     return attr.page === builtinPseudoPage ||
//       !builtins[attr.tag]?.[attr.name];
//   });
//   if (Object.keys(filteredAttributes).length > 0) {
//     await indexObjects(
//       page,
//       filteredAttributes.map((attr) => {
//         return {
//           key: [attr.tag, attr.name],
//           tags: ["attribute"],
//           value: attr,
//         };
//       }),
//     );
//   }
// }

export async function queryObjects<T>(
  tag: string,
  query: KvQuery,
): Promise<ObjectValue<T>[]> {
  return (await datastore.query({
    ...query,
    prefix: ["index", tag, ...(query.prefix ? query.prefix : [])],
  })).map(
    ({ key, value }) => ({ key, value, tags: [tag] }),
  );
}

export async function objectSourceProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const tag = query.querySource!;
  const results = await datastore.query({
    ...query,
    prefix: ["index", tag],
  });
  return results.map((r) => r.value);
}

export async function discoverSources() {
  return (await datastore.query({ prefix: ["index", "tag"] })).map((
    { key },
  ) => key[2]);
}

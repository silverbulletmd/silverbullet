import type { KvPrimitives } from "./kv_primitives.ts";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { InMemoryKvPrimitives } from "./in_memory_kv_primitives.ts";

/**
 * The editor's local datastore: IndexedDB, or memory only when the server
 * says this session keeps nothing on the device ("Shared computer").
 */
export async function openClientKv(
  config: { ephemeralStorage?: boolean },
  dbName: string,
): Promise<KvPrimitives> {
  if (config.ephemeralStorage) {
    console.log("Shared computer session: keeping the datastore in memory");
    return new InMemoryKvPrimitives();
  }
  const kv = new IndexedDBKvPrimitives(dbName);
  await kv.init();
  console.log("Using IndexedDB database", dbName);
  return kv;
}

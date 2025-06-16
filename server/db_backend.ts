import type { KvPrimitives } from "../lib/data/kv_primitives.ts";
import { MemoryKvPrimitives } from "../lib/data/memory_kv_primitives.ts";
import { resolve } from "@std/path";

/**
 * Environment variables:
 * - SB_KV_DB: path to the database file (default .silverbullet.db.json)
 */

export async function determineDatabaseBackend(
  singleTenantFolder?: string,
): Promise<KvPrimitives> {
  let dbFile = Deno.env.get("SB_KV_DB") || ".silverbullet.db.json";

  if (singleTenantFolder) {
    // If we're running in single tenant mode, we may as well use the tenant's space folder to keep the database
    dbFile = resolve(singleTenantFolder, dbFile);
  }

  console.info(
    `Using persistent memory store as a database backend (${dbFile}).`,
  );
  const store = new MemoryKvPrimitives(dbFile);
  await store.init();
  return store;
}

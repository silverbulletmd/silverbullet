import type { KvKey } from "../../plug-api/types/datastore.ts";
import type { KvPrimitives } from "../data/kv_primitives.ts";

export const clientIdKey: KvKey = ["client", "clientId"];

/**
 * Load this client's persisted identity, generating and storing a fresh
 * UUID on first use.
 */
export async function getOrCreateClientId(
  kv: KvPrimitives,
): Promise<string | undefined> {
  try {
    const existing = (await kv.batchGet([clientIdKey]))[0];
    if (typeof existing === "string" && existing) {
      return existing;
    }
    const id = crypto.randomUUID();
    await kv.batchSet([{ key: clientIdKey, value: id }]);
    return id;
  } catch (e: any) {
    console.warn("[client-id] Failed to load/persist client id", e.message);
    return undefined;
  }
}

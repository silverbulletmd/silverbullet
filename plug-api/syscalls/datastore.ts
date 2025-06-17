import type { LuaCollectionQuery } from "../../lib/space_lua/query_collection.ts";
import { syscall } from "../syscall.ts";

import type { KV, KvKey, KvQuery } from "../../type/datastore.ts";

/**
 * Exposes a key value story with query capabilities.
 * @module
 */

/**
 * Sets a value in the key value store.
 * @param key the key to set
 * @param value the value to set
 */
export function set(key: KvKey, value: any): Promise<void> {
  return syscall("datastore.set", key, value);
}

/**
 * Sets multiple values in the key value store.
 * @param kvs the key value pairs to set
 */
export function batchSet(kvs: KV[]): Promise<void> {
  return syscall("datastore.batchSet", kvs);
}

/**
 * Gets a value from the key value store.
 * @param key the key to get
 * @returns the value associated with the key (or undefined if not found)
 */
export function get(key: KvKey): Promise<any | undefined> {
  return syscall("datastore.get", key);
}

/**
 * Gets multiple values from the key value store.
 * @param keys the keys to get
 * @returns the values associated with the keys (or undefined if not found)
 */
export function batchGet(keys: KvKey[]): Promise<(any | undefined)[]> {
  return syscall("datastore.batchGet", keys);
}

/**
 * Deletes a value from the key value store.
 * @param key the key to delete
 */
export function del(key: KvKey): Promise<void> {
  return syscall("datastore.delete", key);
}

/**
 * Deletes multiple values from the key value store.
 * @param keys the keys to delete
 */
export function batchDel(keys: KvKey[]): Promise<void> {
  return syscall("datastore.batchDelete", keys);
}

export function query(options: KvQuery): Promise<KV[]> {
  return syscall("datastore.query", options);
}

export function queryLua(
  prefix: string[],
  query: LuaCollectionQuery,
  scopeVariables?: Record<string, any>,
): Promise<any[]> {
  return syscall("datastore.queryLua", prefix, query, scopeVariables);
}

export function batchDeletePrefix(prefix: KvKey): Promise<void> {
  return syscall("datastore.batchDeletePrefix", prefix);
}

/**
 * Queries the key value store and deletes all matching items
 * @param query the query to run
 * @param variables the variables that can be referenced inside the query
 */
export function queryDelete(
  query: KvQuery,
  variables?: Record<string, any>,
): Promise<void> {
  return syscall("datastore.queryDelete", query, variables);
}

/**
 * Lists all functions currently defined and available for use in queries
 * @returns the names of all functions in the key value store
 */
export function listFunctions(): Promise<string[]> {
  return syscall("datastore.listFunctions");
}

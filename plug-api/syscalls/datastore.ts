import { syscall } from "../syscall.ts";
import type { KV, KvKey, KvQuery } from "../types.ts";

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

/**
 * Queries the key value store.
 * @param query the query to run
 * @param variables the variables that can be referenced inside the query
 * @returns the results of the query
 */
export function query(
  query: KvQuery,
  variables: Record<string, any> = {},
): Promise<KV[]> {
  return syscall("datastore.query", query, variables);
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

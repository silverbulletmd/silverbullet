import { syscall } from "../syscall.ts";

/**
 * Implements a very simple (string) key value store for the client.
 * Generally should only be used to set some client-specific states, such as preferences.
 * @module
 */

/**
 * Sets a value in the client store.
 * @param key the key to set
 * @param value the value to set
 */
export function set(key: string, value: any): Promise<void> {
  return syscall("clientStore.set", key, value);
}

/**
 * Gets a value from the client store.
 * @param key the key to get
 * @returns the value associated with the key
 */
export function get(key: string): Promise<any> {
  return syscall("clientStore.get", key);
}

/**
 * Deletes a value from the client store.
 * @param key the key to delete
 */
export function del(key: string): Promise<void> {
  return syscall("clientStore.delete", key);
}

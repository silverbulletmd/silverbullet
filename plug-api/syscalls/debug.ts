import { syscall } from "../syscall.ts";

/**
 * Exposes various debugging utilities.
 */

/**
 * Completely wipes the client state, both cached files as well as databases (best effort)
 */
export function resetClient(): Promise<void> {
  return syscall("debug.resetClient");
}

/**
 * Wipes the entire state KV store and the entire space KV store.
 */
export function cleanup(): Promise<void> {
  return syscall("debug.cleanup");
}

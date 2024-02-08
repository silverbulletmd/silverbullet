import { syscall } from "../syscall.ts";

export function resetClient() {
  return syscall("debug.resetClient");
}

/**
 * Wipes the entire state KV store and the entire space KV store.
 */
export function cleanup() {
  return syscall("debug.cleanup");
}

import { syscall } from "../syscall.ts";

export function resetClient(): Promise<void> {
  return syscall("debug.resetClient");
}

/**
 * Wipes the entire state KV store and the entire space KV store.
 */
export function cleanup(): Promise<void> {
  return syscall("debug.cleanup");
}

import { syscall } from "../syscall.ts";

/**
 * Syscalls that interact with the sync engine (when the client runs in Sync mode)
 * @module
 */

/**
 * Checks if a sync is currently in progress
 */
export function isSyncing(): Promise<boolean> {
  return syscall("sync.isSyncing");
}

/**
 * Checks if an initial sync has completed
 */
export function hasInitialSyncCompleted(): Promise<boolean> {
  return syscall("sync.hasInitialSyncCompleted");
}

/**
 * Syncs a file immediately. Sync would happen automatically, but this prioritizes the file.
 * @param path the path to the file to sync
 */
export function performFileSync(path: string): Promise<void> {
  return syscall("sync.performFileSync", path);
}

/**
 * Performs an immediate full sync.
 */
export function performSpaceSync(): Promise<number> {
  return syscall("sync.performSpaceSync");
}

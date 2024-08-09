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
 * Actively schedules a file to be synced. Sync will happen by default too, but this prioritizes the file.
 * @param path the path to the file to sync
 */
export function scheduleFileSync(path: string): Promise<void> {
  return syscall("sync.scheduleFileSync", path);
}

/**
 * Schedules a sync of without waiting for the usual sync interval.
 */
export function scheduleSpaceSync(): Promise<number> {
  return syscall("sync.scheduleSpaceSync");
}

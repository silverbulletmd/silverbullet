import { syscall } from "../syscall.ts";

/**
 * Syscalls that interact with the sync engine (when the client runs in Sync mode)
 * @module
 */

/**
 * Checks if an initial sync has completed
 */
export function hasInitialSyncCompleted(): Promise<boolean> {
  return syscall("sync.hasInitialSyncCompleted");
}

/**
 * Syncs a file immediately. Sync would happen automatically, but this prioritizes the file.
 * @param path the path to the file to sync
 * @param remoteLastModified lastModified of the remote change event, used for echo suppression
 * @param remoteRevisionHash content revision the remote change event reported, which tells a same-millisecond change from an echo
 */
export function performFileSync(
  path: string,
  remoteLastModified?: number,
  remoteRevisionHash?: string,
): Promise<void> {
  return syscall(
    "sync.performFileSync",
    path,
    remoteLastModified,
    remoteRevisionHash,
  );
}

/**
 * Performs an immediate full sync.
 */
export function performSpaceSync(): Promise<number> {
  return syscall("sync.performSpaceSync");
}

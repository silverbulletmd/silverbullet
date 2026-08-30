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
 * For each file, whether indexing it now would read it locally or cheaply
 * (true), or race the initial sync and expensively re-download it (false).
 * Always all-true outside a fresh install's initial index window.
 * @param paths the space-relative file paths
 */
export function areFilesReadyToIndex(paths: string[]): Promise<boolean[]> {
  return syscall("sync.areFilesReadyToIndex", paths);
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

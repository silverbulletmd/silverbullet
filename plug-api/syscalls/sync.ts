import { syscall } from "../syscall.ts";

export function isSyncing(): Promise<boolean> {
  return syscall("sync.isSyncing");
}

export function hasInitialSyncCompleted(): Promise<boolean> {
  return syscall("sync.hasInitialSyncCompleted");
}

export function scheduleFileSync(path: string): Promise<void> {
  return syscall("sync.scheduleFileSync", path);
}

export function scheduleSpaceSync(): Promise<number> {
  return syscall("sync.scheduleSpaceSync");
}

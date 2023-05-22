import { syscall } from "$sb/silverbullet-syscall/syscall.ts";

export function isSyncing(): Promise<boolean> {
  return syscall("sync.isSyncing");
}

export function hasInitialSyncCompleted(): Promise<boolean> {
  return syscall("sync.hasInitialSyncCompleted");
}

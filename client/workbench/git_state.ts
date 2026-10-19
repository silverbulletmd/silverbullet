import { space } from "@silverbulletmd/silverbullet/syscalls";
import type {
  GitConflict,
  GitSyncSnapshot,
} from "@silverbulletmd/silverbullet/type/revisions";
import { PermissionDeniedError } from "../spaces/http_space_primitives.ts";

/** Git sync as Overview and Health show it; `conflicts` is undefined when listing them failed. */
export type GitState = {
  snapshot: GitSyncSnapshot;
  conflicts: GitConflict[] | undefined;
};

export type GitSources = {
  syncStatus: () => Promise<GitSyncSnapshot | undefined>;
  conflicts: () => Promise<GitConflict[]>;
};

export const gitSources: GitSources = {
  syncStatus: () => space.getGitSyncStatus(),
  conflicts: async () => (await space.getGitConflicts()).conflicts,
};

/**
 * The Git sync snapshot, or undefined when Git is off. With revisions off
 * (the default) the endpoint answers 404, which is expected and not logged.
 */
export function gitSyncOrOff(
  p: Promise<GitSyncSnapshot | undefined>,
): Promise<GitSyncSnapshot | undefined> {
  return p.catch((e) => {
    const status = (e as { status?: number } | null)?.status;
    const off =
      status === 404 || status === 403 || e instanceof PermissionDeniedError;
    if (!off) console.warn("Git sync status failed", e);
    return undefined;
  });
}

/** Undefined when Git sync is off; conflicts are only asked for when it's on. */
export async function loadGitState(
  src: GitSources,
): Promise<GitState | undefined> {
  const snapshot = await gitSyncOrOff(src.syncStatus());
  if (!snapshot?.enabled) return undefined;
  const conflicts = await src.conflicts().catch((e) => {
    console.warn("Git conflicts failed", e);
    return undefined;
  });
  return { snapshot, conflicts };
}

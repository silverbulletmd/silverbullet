import type { GitSyncSnapshot } from "@silverbulletmd/silverbullet/type/revisions";
import { describeSync, syncStatusText } from "../sync_notification.ts";
import { describeSyncError } from "./git_sync_copy.ts";
import type { GitStatus, SpaceInfo } from "./types.ts";

/** Whether `space` is set up to sync with a git remote. */
export function gitSyncsWith(space: SpaceInfo): boolean {
  return (
    space.revisions === "managed" && (space.gitSync?.mode ?? "off") !== "off"
  );
}

function gitSyncSnapshot(status: GitStatus): GitSyncSnapshot {
  return {
    sync: status.sync,
    enabled: status.enabled ?? status.credentialMode !== "off",
    paused: status.paused ?? false,
    lastSuccess: status.lastSuccess ?? null,
    lastAttempt: status.lastAttempt ?? null,
    version: status.version ?? 0,
    pending: status.ahead,
    incoming: status.behind,
    dirty: status.dirty,
  };
}

/** One line describing a space's git sync, as its git page shows it. */
export function gitStatusText(status: GitStatus): string {
  return syncStatusText(gitSyncSnapshot(status));
}

/**
 * The same state without its detail, for the Status → Sync table, whose
 * other columns already carry the time and the outgoing/incoming counts.
 */
export function gitStateLabel(status: GitStatus): string {
  return describeSync(gitSyncSnapshot(status)).label;
}

/** What went wrong with a space's git sync, or null when nothing did. */
export function gitProblemText(status: GitStatus): string | null {
  return status.sync.state === "error"
    ? describeSyncError(status.sync.kind, status.sync.message ?? "")
    : null;
}

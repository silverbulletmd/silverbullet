import type { SyncState } from "@silverbulletmd/silverbullet/type/revisions";

export function sameSyncState(a: SyncState, b: SyncState): boolean {
  if (a.state !== b.state) return false;
  switch (a.state) {
    case "conflicted":
      return (
        b.state === "conflicted" &&
        a.paths.length === b.paths.length &&
        a.paths.every((p, i) => p === b.paths[i])
      );
    case "paused":
      return b.state === "paused" && a.reason === b.reason;
    case "error":
      return (
        b.state === "error" && a.kind === b.kind && a.message === b.message
      );
    case "idle":
    case "syncing":
      return true;
  }
}

export function isLoudSyncState(state: SyncState): boolean {
  if (state.state === "conflicted") return state.paths.length > 0;
  return state.state === "error" || state.state === "paused";
}

// Reconnecting SSE must not resurrect a notification the user dismissed.
export function shouldFlashSyncNotification(
  next: SyncState,
  last: SyncState | undefined,
): boolean {
  if (!isLoudSyncState(next)) return false;
  return last === undefined || !sameSyncState(next, last);
}

/** A sync state as a short label, plus what a fuller line adds to it. */
export type SyncDescription = { label: string; detail?: string };

export function describeSync(
  snapshot: import("@silverbulletmd/silverbullet/type/revisions").GitSyncSnapshot,
): SyncDescription {
  if (!snapshot.enabled) return { label: "Disconnected" };
  if (snapshot.paused) return { label: "Sync paused" };
  switch (snapshot.sync.state) {
    case "syncing":
      return { label: "Syncing…" };
    case "conflicted":
      return {
        label: `${snapshot.sync.paths.length} files need conflict resolution`,
      };
    case "paused":
      return { label: "Sync paused", detail: snapshot.sync.reason };
    case "error":
      return { label: "Sync needs attention" };
    case "idle":
      if (snapshot.dirty)
        return {
          label: "Changes waiting",
          detail: "local edits await an automatic commit",
        };
      if (snapshot.pending || snapshot.incoming)
        return {
          label: "Changes waiting",
          detail: `${snapshot.pending ?? "unknown"} outgoing, ${snapshot.incoming ?? "unknown"} incoming`,
        };
      if (!snapshot.lastSuccess)
        return { label: "Waiting for the first successful sync" };
      if (snapshot.pending === null || snapshot.incoming === null)
        return {
          label: "Last sync succeeded",
          detail: "pending changes are not known",
        };
      return {
        label: "Up to date",
        detail: new Date(snapshot.lastSuccess).toLocaleString(),
      };
  }
}

/** A sync state as one line: the label, then any detail. */
export function syncStatusText(
  snapshot: import("@silverbulletmd/silverbullet/type/revisions").GitSyncSnapshot,
): string {
  const { label, detail } = describeSync(snapshot);
  return detail ? `${label} — ${detail}` : label;
}

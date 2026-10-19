export type RevisionEntry = {
  rev: string;
  timestamp: number;
  author: string;
  message: string;
  added?: number;
  removed?: number;
};

export type FileRevisions = {
  mode: "managed" | "unmanaged" | "disabled";
  uncommitted: boolean;
  revisions: RevisionEntry[];
  more: boolean;
};

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export type LogFile = { path: string; status: FileStatus };

export type LogCommit = RevisionEntry & { files: LogFile[] };

export type SpaceActivity = {
  /** Commit timestamps (unix seconds) since the requested start. */
  commits: number[];
  topFiles: { path: string; count: number }[];
  /** Commit counts per author name since `filesSince`, the same window as `topFiles`. */
  authors: { name: string; count: number }[];
};

export type SpaceLog = {
  mode: "managed" | "unmanaged" | "disabled";
  commits: LogCommit[];
  more: boolean;
  /** What differs from HEAD right now -- what a snapshot would capture. */
  uncommitted: LogFile[];
  sync?: SyncState | null;
};

/** Mirrors the server's `SyncState` (`revisions::engine`), which serializes
 * with `#[serde(tag = "state", rename_all = "camelCase")]` -- that renames
 * variant names but not their fields, so `Paused`'s field stays `reason`,
 * not `message`. `message` is absent on the `/.events` frame, which any
 * Read-level visitor receives; `/.revisions/` and the admin route carry it. */
export type SyncState =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "conflicted"; paths: string[] }
  | { state: "paused"; reason: string }
  | { state: "error"; kind: string; message?: string };

export type GitSyncSnapshot = {
  sync: SyncState;
  lastAttempt: number | null;
  lastSuccess: number | null;
  version: number;
  enabled: boolean;
  paused: boolean;
  dirty?: boolean;
  pending: number | null;
  incoming: number | null;
};

export type GitConflict = {
  id: string;
  path: string;
  kind: "text" | "binary" | "deleteModify" | "unsupported";
  local: boolean;
  remote: boolean;
  contentRevision: string;
  canResolve?: boolean;
};

export type GitConflicts = { generation: string; conflicts: GitConflict[] };
export type GitConflictAction = "local" | "remote" | "edited" | "delete";

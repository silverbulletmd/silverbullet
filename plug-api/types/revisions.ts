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

export type SpaceLog = {
  mode: "managed" | "unmanaged" | "disabled";
  commits: LogCommit[];
  more: boolean;
  /** What differs from HEAD right now -- what a snapshot would capture. */
  uncommitted: LogFile[];
};

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

export type LogCommit = RevisionEntry & { files: string[] };

export type SpaceLog = {
  mode: "managed" | "unmanaged" | "disabled";
  commits: LogCommit[];
  more: boolean;
  /** Paths differing from HEAD right now -- what a snapshot would capture. */
  uncommitted: string[];
};

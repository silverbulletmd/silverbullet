export type Message = {
  id: string;
  queue: string;
  body: any;
  retries?: number;
};

export type QueueStats = {
  queued: number;
  processing: number;
  dlq: number;
};

export type FileMeta = {
  name: string;
  lastModified: number;
  contentType: string;
  size: number;
  perm: "ro" | "rw";
  noSync?: boolean;
} & Record<string, any>;

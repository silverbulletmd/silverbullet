export type MQMessage = {
  id: string;
  queue: string;
  body: any;
  retries?: number;
};

export type MQStats = {
  queued: number;
  processing: number;
  dlq: number;
};

export type MQSubscribeOptions = {
  batchSize?: number;
  pollInterval?: number;
};

export type FileMeta = {
  name: string;
  lastModified: number;
  contentType: string;
  size: number;
  perm: "ro" | "rw";
  noSync?: boolean;
} & Record<string, any>;

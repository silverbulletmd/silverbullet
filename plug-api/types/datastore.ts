// Message Queue related types
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

// KV types
export type KvKey = string[];

export type KV<T = any> = {
  key: KvKey;
  value: T;
};

export type KvQuery = {
  prefix?: KvKey;
};

/**
 * Body of an `indexQueue` message: a plain path, or a path a producer has
 * already cleared the index for (a full reindex empties the index wholesale
 * before queueing). Shared by the producers (`client/data/object_index.ts`)
 * and the consumer (`plugs/index/queue.ts`) so the two ends of the queue
 * cannot drift.
 */
export type IndexQueueBody = string | { path: string; cleared?: boolean };

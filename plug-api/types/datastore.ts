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
  /** Minimum delay in ms between processing batches when queue is non-empty.
   * Yields the event loop so other async work (UI, IDB reads) can run. */
  interBatchDelay?: number;
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

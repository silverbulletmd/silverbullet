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

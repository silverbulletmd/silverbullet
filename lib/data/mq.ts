import {
  MQMessage,
  MQStats,
  MQSubscribeOptions,
} from "../../plug-api/types.ts";

export interface MessageQueue {
  batchSend(queue: string, bodies: any[]): Promise<void>;
  send(queue: string, body: any): Promise<void>;
  subscribe(
    queue: string,
    options: MQSubscribeOptions,
    callback: (messages: MQMessage[]) => Promise<void> | void,
  ): () => void;
  ack(queue: string, id: string): Promise<void>;
  batchAck(queue: string, ids: string[]): Promise<void>;

  getQueueStats(queue: string): Promise<MQStats>;
  getAllQueueStats(): Promise<Record<string, MQStats>>;
}

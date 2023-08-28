/// <reference lib="deno.unstable" />

import {
  MQMessage,
  MQStats,
  MQSubscribeOptions,
} from "../../plug-api/types.ts";
import { MessageQueue } from "./mq.ts";

type QueuedMessage = [string, MQMessage];

export class DenoKvMQ implements MessageQueue {
  listeners: Map<string, Set<(messages: MQMessage[]) => void | Promise<void>>> =
    new Map();

  constructor(private kv: Deno.Kv) {
    kv.listenQueue(async (message: unknown) => {
      const [queue, body] = message as QueuedMessage;
      const listeners = this.listeners.get(queue);
      if (!listeners) {
        return;
      }
      for (const listener of listeners) {
        await Promise.resolve(listener([{ id: "_dummyid", queue, body }]));
      }
    });
  }

  // Dummy implementation
  getQueueStats(_queue: string): Promise<MQStats> {
    return Promise.resolve({
      queued: 0,
      processing: 0,
      dlq: 0,
    });
  }

  // Dummy implementation
  getAllQueueStats(): Promise<Record<string, MQStats>> {
    return Promise.resolve({});
  }

  async batchSend(queue: string, bodies: any[]): Promise<void> {
    const results = await Promise.all(
      bodies.map((body) => this.kv.enqueue([queue, body])),
    );
    for (const result of results) {
      if (!result.ok) {
        throw result;
      }
    }
  }
  async send(queue: string, body: any): Promise<void> {
    const result = await this.kv.enqueue([queue, body]);
    if (!result.ok) {
      throw result;
    }
  }
  subscribe(
    queue: string,
    _options: MQSubscribeOptions,
    callback: (messages: MQMessage[]) => void | Promise<void>,
  ): () => void {
    const listeners = this.listeners.get(queue);
    if (!listeners) {
      this.listeners.set(queue, new Set([callback]));
    } else {
      listeners.add(callback);
    }

    return () => {
      const listeners = this.listeners.get(queue);
      if (!listeners) {
        return;
      }
      listeners.delete(callback);
    };
  }
  ack(_queue: string, _id: string): Promise<void> {
    // Doesn't apply to this implementation
    return Promise.resolve();
  }
  batchAck(_queue: string, _ids: string[]): Promise<void> {
    // Doesn't apply to this implementation
    return Promise.resolve();
  }
}

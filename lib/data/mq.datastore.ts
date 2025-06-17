import type { DataStore } from "./datastore.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import { LuaEnv } from "../space_lua/runtime.ts";
import type {
  KV,
  KvKey,
  MQMessage,
  MQStats,
  MQSubscribeOptions,
} from "../../type/datastore.ts";

export type ProcessingMessage = MQMessage & {
  ts: number;
};

const queuedPrefix = ["mq", "queued"];
const processingPrefix = ["mq", "processing"];
const dlqPrefix = ["mq", "dlq"];

export class DataStoreMQ {
  // queue -> set of run() functions
  localSubscriptions = new Map<string, Set<() => void>>();
  // Internal sequencer for messages, only really necessary when batch sending tons of messages within a millisecond
  seq = 0;

  constructor(
    private ds: DataStore,
  ) {
  }

  async batchSend(queue: string, bodies: any[]): Promise<void> {
    if (bodies.length === 0) {
      return;
    }
    const messages: KV<MQMessage>[] = bodies.map((body) => {
      const id = `${Date.now()}-${String(++this.seq).padStart(6, "0")}`;
      const key = [...queuedPrefix, queue, id];
      return {
        key,
        value: { id, queue, body },
      };
    });

    await this.ds.batchSet(messages);

    // See if we can immediately process the message with a local subscription
    const localSubscriptions = this.localSubscriptions.get(queue);
    if (localSubscriptions) {
      for (const run of localSubscriptions) {
        run();
      }
    }
  }

  send(queue: string, body: any): Promise<void> {
    return this.batchSend(queue, [body]);
  }

  async poll(queue: string, maxItems: number): Promise<MQMessage[]> {
    // Note: this is not happening in a transactional way, so we may get duplicate message delivery
    // Retrieve a batch of messages
    const messages = await this.ds.luaQuery<MQMessage>(
      [...queuedPrefix, queue],
      {
        limit: maxItems,
      },
    );
    if (messages.length === 0) {
      return [];
    }
    // Put them in the processing queue
    await this.ds.batchSet(
      messages.map((m) => ({
        key: [...processingPrefix, queue, m.id],
        value: {
          ...m,
          ts: Date.now(),
        },
      })),
    );
    // Delete them from the queued queue
    await this.ds.batchDelete(
      messages.map((m) => [...queuedPrefix, queue, m.id]),
    );

    // Return them
    return messages;
  }

  /**
   * @param queue
   * @param batchSize
   * @param callback
   * @returns a function to be called to unsubscribe
   */
  subscribe(
    queue: string,
    options: MQSubscribeOptions,
    callback: (messages: MQMessage[]) => Promise<void> | void,
  ): () => void {
    let running = true;
    let timeout: number | undefined;
    const batchSize = options.batchSize || 1;
    const run = async () => {
      try {
        // We're running, so let's make sure we're not running multiple times
        if (timeout) {
          clearTimeout(timeout);
        }
        if (!running) {
          return;
        }
        const messages = await this.poll(queue, batchSize);
        if (messages.length > 0) {
          await callback(messages);
        }
        // If we got exactly the batch size, there might be more messages
        if (messages.length === batchSize) {
          await run();
        }
        timeout = setTimeout(run, options.pollInterval || 5000);
      } catch (e: any) {
        console.error("Error in MQ subscription handler", e);
      }
    };

    // Register as a local subscription handler
    const localSubscriptions = this.localSubscriptions.get(queue);
    if (!localSubscriptions) {
      this.localSubscriptions.set(queue, new Set([run]));
    } else {
      localSubscriptions.add(run);
    }

    // Run the first time (which will schedule subsequent polling intervals)
    run();

    // And return an unsubscribe function
    return () => {
      running = false;
      if (timeout) {
        clearTimeout(timeout);
      }
      // Remove the subscription from localSubscriptions
      const queueSubscriptions = this.localSubscriptions.get(queue);
      if (queueSubscriptions) {
        queueSubscriptions.delete(run);
      }
    };
  }

  ack(queue: string, id: string) {
    return this.batchAck(queue, [id]);
  }

  async batchAck(queue: string, ids: string[]) {
    if (ids.length === 0) {
      return;
    }
    await this.ds.batchDelete(
      ids.map((id) => [...processingPrefix, queue, id]),
    );
  }

  async requeueTimeouts(
    timeout: number,
    maxRetries?: number,
    disableDLQ?: boolean,
  ) {
    const now = Date.now();
    const env = new LuaEnv();
    env.setLocal("ts", now - timeout);
    const messages = await this.ds.luaQuery<ProcessingMessage>(
      processingPrefix,
      {
        objectVariable: "m",
        where: parseExpressionString("m.ts < ts"),
      },
      env,
    );
    if (messages.length === 0) {
      return;
    }
    await this.ds.batchDelete(
      messages.map((m) => [...processingPrefix, m.queue, m.id]),
    );
    const newMessages: KV<ProcessingMessage>[] = [];
    for (const m of messages) {
      const retries = (m.retries || 0) + 1;
      if (maxRetries && retries > maxRetries) {
        if (disableDLQ) {
          console.warn(
            "[mq]",
            "Message exceeded max retries, flushing message",
            m,
          );
        } else {
          console.warn(
            "[mq]",
            "Message exceeded max retries, moving to DLQ",
            m,
          );
          newMessages.push({
            key: [...dlqPrefix, m.queue, m.id],
            value: {
              queue: m.queue,
              id: m.id,
              body: m.body,
              ts: Date.now(),
              retries,
            },
          });
        }
      } else {
        console.info("[mq]", "Message ack timed out, requeueing", m);
        newMessages.push({
          key: [...queuedPrefix, m.queue, m.id],
          value: {
            ...m,
            retries,
          },
        });
      }
    }
    await this.ds.batchSet(newMessages);
  }

  async fetchDLQMessages(): Promise<ProcessingMessage[]> {
    return (await this.ds.luaQuery<ProcessingMessage>(dlqPrefix, {}));
  }

  async fetchProcessingMessages(): Promise<ProcessingMessage[]> {
    return (await this.ds.luaQuery<ProcessingMessage>(processingPrefix, {}));
  }

  async flushDLQ(): Promise<void> {
    const ids: KvKey[] = [];
    for (const item of await this.ds.luaQuery<MQMessage>(dlqPrefix, {})) {
      ids.push([...dlqPrefix, item.queue, item.id]);
    }
    await this.ds.batchDelete(ids);
  }

  /**
   * Flushes a queue, including all queued, processing and DLQ messages
   * @param queue
   */
  async flushQueue(queue: string): Promise<void> {
    const ids: KvKey[] = [];
    for (
      const item of await this.ds.luaQuery<MQMessage>(
        [...queuedPrefix, queue],
        {},
      )
    ) {
      ids.push([...queuedPrefix, item.id]);
    }
    for (
      const item of await this.ds.luaQuery<ProcessingMessage>([
        ...processingPrefix,
        queue,
      ], {})
    ) {
      ids.push([...processingPrefix, item.id]);
    }
    for (
      const item of await this.ds.luaQuery<ProcessingMessage>([
        ...dlqPrefix,
        queue,
      ], {})
    ) {
      ids.push([...dlqPrefix, item.id]);
    }
    await this.ds.batchDelete(ids);
  }

  async getQueueStats(queue: string): Promise<MQStats> {
    const queued =
      (await (this.ds.luaQuery([...queuedPrefix, queue], {}))).length;
    const processing =
      (await (this.ds.luaQuery([...processingPrefix, queue], {}))).length;
    const dlq = (await (this.ds.luaQuery([...dlqPrefix, queue], {}))).length;
    return {
      queued,
      processing,
      dlq,
    };
  }

  async getAllQueueStats(): Promise<Record<string, MQStats>> {
    const allStatus: Record<string, MQStats> = {};
    for (
      const message of await this.ds.luaQuery<MQMessage>(
        queuedPrefix,
        {},
      )
    ) {
      if (!allStatus[message.queue]) {
        allStatus[message.queue] = {
          queued: 0,
          processing: 0,
          dlq: 0,
        };
      }
      allStatus[message.queue].queued++;
    }
    for (
      const message of await this.ds.luaQuery<MQMessage>(
        processingPrefix,
        {},
      )
    ) {
      if (!allStatus[message.queue]) {
        allStatus[message.queue] = {
          queued: 0,
          processing: 0,
          dlq: 0,
        };
      }
      allStatus[message.queue].processing++;
    }
    for (
      const message of await this.ds.luaQuery<MQMessage>(
        dlqPrefix,
        {},
      )
    ) {
      if (!allStatus[message.queue]) {
        allStatus[message.queue] = {
          queued: 0,
          processing: 0,
          dlq: 0,
        };
      }
      allStatus[message.queue].dlq++;
    }

    return allStatus;
  }
}

import type { DataStore } from "./datastore.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import { LuaEnv } from "../space_lua/runtime.ts";
import type {
  KV,
  KvKey,
  MQMessage,
  MQStats,
  MQSubscribeOptions,
} from "../../plug-api/types/datastore.ts";
import { race, sleep } from "@silverbulletmd/silverbullet/lib/async";

export type ProcessingMessage = MQMessage & {
  ts: number;
};

const queuedPrefix = ["mq", "queued"];
const processingPrefix = ["mq", "processing"];
const dlqPrefix = ["mq", "dlq"];

export class QueueWorker {
  stopping = false;
  private stopReject?: (e: any) => void;

  constructor(
    private mq: DataStoreMQ,
    readonly queue: string,
    readonly options: MQSubscribeOptions,
    private callback: (messages: MQMessage[]) => Promise<void> | void,
  ) {
  }

  /**
   * This is the main loop of the worker, whenever it exits the loop it means the worker has stopped
   */
  async run() {
    try {
      while (true) {
        if (this.stopping) {
          break;
        }
        // Poll for messages
        const messages = await this.mq.poll(
          this.queue,
          this.options.batchSize || 1,
        );
        if (messages.length > 0) {
          // We have messages, process them, then immediately loop to poll again
          await this.callback(messages);
        } else {
          // No messages, wait to be woken up or a timeout
          try {
            await race([
              // Wait to be woken up explicitly
              new Promise<void>((resolve, reject) => {
                this.stopReject = reject;
                this.mq.queueWorker(this.queue, resolve, reject);
              }),
              // Or a poll interval timeout
              sleep(this.options.pollInterval || 1000).then(() => {
                // Remove self from waiters
                this.mq.removeQueuedWorker(this.queue, this.stopReject!);
              }),
            ]);
          } catch (e: any) {
            // Only scenario we should end up here is stop being called
            console.info(e.message);
            break;
          }
        }
      }
    } catch (e) {
      console.error("Error in queue worker", e);
    }
  }

  stop() {
    this.stopping = true;
    if (this.stopReject) {
      // Worker was in a waiting state, reject the promise to wake it up and remove from waiters
      this.mq.removeQueuedWorker(this.queue, this.stopReject);
      this.stopReject(new Error("Queue worker stopped"));
    }
  }
}

/**
 * Basic message queue implementation on top of a DataStore
 */
export class DataStoreMQ {
  // Internal sequencer for messages, only really necessary when batch sending tons of messages within a millisecond
  seq = 0;

  queueWaiters = new Map<
    string,
    ({ resolve: () => void; reject: (e: any) => void })[]
  >();

  constructor(
    private ds: DataStore,
  ) {
  }

  /// Worker management
  public queueWorker(
    queue: string,
    resolve: () => void,
    reject: (e: any) => void,
  ) {
    let waiters = this.queueWaiters.get(queue);
    if (!waiters) {
      waiters = [];
      this.queueWaiters.set(queue, waiters);
    }
    // console.log("[mq]", "Queuing a worker for queue", queue);
    waiters.push({ resolve, reject });
  }

  /**
   * Wakes up a single worker waiting on the given queue, if any
   * @param queue
   */
  wakeupWorker(queue: string) {
    const waiters = this.queueWaiters.get(queue);
    if (waiters && waiters.length > 0) {
      // console.log("[mq]", "Waking up a worker for queue", queue);
      const { resolve } = waiters.shift()!;
      resolve();
      if (waiters.length === 0) {
        // Clean up empty arrays
        this.queueWaiters.delete(queue);
      }
    }
  }

  removeQueuedWorker(queue: string, reject: (e: any) => void) {
    const waiters = this.queueWaiters.get(queue);
    if (waiters) {
      const index = waiters.findIndex((w) => w.reject === reject);
      if (index !== -1) {
        waiters.splice(index, 1);
      }
      if (waiters.length === 0) {
        // Let's not keep empty arrays around
        this.queueWaiters.delete(queue);
      }
    }
  }

  /**
   * Sends a batch of messages to a queue.
   * @param queue the name of the queue
   * @param bodies the bodies of the messages to send
   * @returns
   */
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

    this.wakeupWorker(queue);
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
  ): QueueWorker {
    const worker = new QueueWorker(this, queue, options, callback);
    // Start the worker asynchronously
    worker.run();
    return worker;
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
      ids.push([...queuedPrefix, queue, item.id]);
    }
    for (
      const item of await this.ds.luaQuery<ProcessingMessage>([
        ...processingPrefix,
        queue,
      ], {})
    ) {
      ids.push([...processingPrefix, queue, item.id]);
    }
    for (
      const item of await this.ds.luaQuery<ProcessingMessage>([
        ...dlqPrefix,
        queue,
      ], {})
    ) {
      ids.push([...dlqPrefix, queue, item.id]);
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

  async awaitEmptyQueue(queue: string): Promise<void> {
    while (true) {
      const stats = await this.getQueueStats(queue);
      if (stats.queued === 0 && stats.processing === 0) {
        break;
      }
      await sleep(200);
    }
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

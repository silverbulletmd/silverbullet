import { race, sleep } from "@silverbulletmd/silverbullet/lib/async";
import type {
  KV,
  KvKey,
  MQMessage,
  MQStats,
  MQSubscribeOptions,
} from "../../plug-api/types/datastore.ts";
import type { EventHook } from "../plugos/hooks/event.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import { LuaEnv } from "../space_lua/runtime.ts";
import type { DataStore } from "./datastore.ts";

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
  ) {}

  /**
   * This is the main loop of the worker, whenever it exits the loop it means the worker has stopped
   */
  async run() {
    try {
      while (true) {
        if (this.stopping) {
          break;
        }
        if (this.mq.isQueuePaused(this.queue)) {
          await sleep(500);
          continue;
        }
        // Poll for messages
        const messages = await this.mq.poll(
          this.queue,
          this.options.batchSize || 1,
        );
        if (messages.length > 0) {
          // We have messages, process them
          await this.callback(messages);
          // Yield to the event loop between batches so other async work
          // (main-thread IDB reads, UI rendering) can run. A small mandatory
          // pause prevents a busy queue from starving everything else.
          const delay = this.options.interBatchDelay ?? 0;
          await sleep(delay);
        } else {
          // No messages, wait to be woken up or a timeout
          void this.mq.eventHook.dispatchEvent(
            `mq:emptyQueue:${this.queue}`,
            this.queue,
          );
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
          } catch {
            // Only scenario we should end up here is stop being called
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
    { resolve: () => void; reject: (e: any) => void }[]
  >();

  private initializingPromises = new Map<string, Promise<void>>();
  private initializedQueues = new Set<string>();
  private queuedCounts = new Map<string, number>();
  private processingCounts = new Map<string, number>();
  private pausedQueues = new Set<string>();

  public setQueuePaused(queue: string, paused: boolean) {
    if (paused) {
      this.pausedQueues.add(queue);
    } else {
      this.pausedQueues.delete(queue);
      // Wake up any waiting workers if we unpause
      this.wakeupWorker(queue);
    }
  }

  public isQueuePaused(queue: string): boolean {
    return this.pausedQueues.has(queue);
  }

  private ensureQueueInitialized(queue: string): Promise<void> {
    let promise = this.initializingPromises.get(queue);
    if (!promise) {
      promise = (async () => {
        const stats = await this.getQueueStats(queue);
        this.queuedCounts.set(queue, stats.queued);
        this.processingCounts.set(queue, stats.processing);
        this.initializedQueues.add(queue);
      })();
      this.initializingPromises.set(queue, promise);
    }
    return promise;
  }

  constructor(
    private ds: DataStore,
    public eventHook: EventHook,
  ) {}

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

    await this.ensureQueueInitialized(queue);

    const messages: KV<MQMessage>[] = bodies.map((body) => {
      const id = `${Date.now()}-${String(++this.seq).padStart(6, "0")}`;
      const key = [...queuedPrefix, queue, id];
      return {
        key,
        value: { id, queue, body },
      };
    });

    await this.ds.batchSet(messages);

    this.queuedCounts.set(
      queue,
      (this.queuedCounts.get(queue) || 0) + bodies.length,
    );

    this.wakeupWorker(queue);
  }

  send(queue: string, body: any): Promise<void> {
    return this.batchSend(queue, [body]);
  }

  async poll(queue: string, maxItems: number): Promise<MQMessage[]> {
    await this.ensureQueueInitialized(queue);

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

    const qCount = this.queuedCounts.get(queue) || 0;
    const pCount = this.processingCounts.get(queue) || 0;
    this.queuedCounts.set(queue, Math.max(0, qCount - messages.length));
    this.processingCounts.set(queue, pCount + messages.length);

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
    void worker.run();
    return worker;
  }

  ack(queue: string, id: string) {
    return this.batchAck(queue, [id]);
  }

  async batchAck(queue: string, ids: string[]) {
    if (ids.length === 0) {
      return;
    }
    await this.ensureQueueInitialized(queue);

    await this.ds.batchDelete(
      ids.map((id) => [...processingPrefix, queue, id]),
    );
    const pCount = this.processingCounts.get(queue) || 0;
    this.processingCounts.set(queue, Math.max(0, pCount - ids.length));
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
      await this.ensureQueueInitialized(m.queue);
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
        const pCount = this.processingCounts.get(m.queue) || 0;
        this.processingCounts.set(m.queue, Math.max(0, pCount - 1));
      } else {
        console.info("[mq]", "Message ack timed out, requeueing", m);
        newMessages.push({
          key: [...queuedPrefix, m.queue, m.id],
          value: {
            ...m,
            retries,
          },
        });
        const qCount = this.queuedCounts.get(m.queue) || 0;
        const pCount = this.processingCounts.get(m.queue) || 0;
        this.queuedCounts.set(m.queue, qCount + 1);
        this.processingCounts.set(m.queue, Math.max(0, pCount - 1));
      }
    }
    await this.ds.batchSet(newMessages);
  }

  async fetchDLQMessages(): Promise<ProcessingMessage[]> {
    return await this.ds.luaQuery<ProcessingMessage>(dlqPrefix, {});
  }

  async fetchProcessingMessages(): Promise<ProcessingMessage[]> {
    return await this.ds.luaQuery<ProcessingMessage>(processingPrefix, {});
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
    await this.ensureQueueInitialized(queue);

    const ids: KvKey[] = [];
    for (const item of await this.ds.luaQuery<MQMessage>(
      [...queuedPrefix, queue],
      {},
    )) {
      ids.push([...queuedPrefix, queue, item.id]);
    }
    for (const item of await this.ds.luaQuery<ProcessingMessage>(
      [...processingPrefix, queue],
      {},
    )) {
      ids.push([...processingPrefix, queue, item.id]);
    }
    for (const item of await this.ds.luaQuery<ProcessingMessage>(
      [...dlqPrefix, queue],
      {},
    )) {
      ids.push([...dlqPrefix, queue, item.id]);
    }
    await this.ds.batchDelete(ids);

    this.queuedCounts.set(queue, 0);
    this.processingCounts.set(queue, 0);
  }

  /**
   * Flushes all queues
   */
  flushAllQueues() {
    this.queuedCounts.clear();
    this.processingCounts.clear();
    this.initializedQueues.clear();
    this.initializingPromises.clear();
    return this.ds.batchDeletePrefix(["mq"]);
  }

  async getQueueStats(queue?: string): Promise<MQStats> {
    const queued = await this.ds.kv.countQuery({
      prefix: queue ? [...queuedPrefix, queue] : queuedPrefix,
    });
    const processing = await this.ds.kv.countQuery({
      prefix: queue ? [...processingPrefix, queue] : processingPrefix,
    });
    const dlq = await this.ds.kv.countQuery({
      prefix: queue ? [...dlqPrefix, queue] : dlqPrefix,
    });
    return {
      queued,
      processing,
      dlq,
    };
  }

  public async isQueueEmpty(queue: string): Promise<boolean> {
    await this.ensureQueueInitialized(queue);
    return (
      (this.queuedCounts.get(queue) || 0) === 0 &&
      (this.processingCounts.get(queue) || 0) === 0
    );
  }

  /**
   * Waits until the queue is empty. Uses event-driven signalling (mq:emptyQueue)
   * instead of polling, so it resolves as soon as the QueueWorker reports empty.
   */
  public async awaitEmptyQueue(queue: string): Promise<void> {
    if (await this.isQueueEmpty(queue)) {
      return;
    }
    await new Promise<void>((resolve) => {
      const handler = async () => {
        if (await this.isQueueEmpty(queue)) {
          this.eventHook.removeLocalListener(`mq:emptyQueue:${queue}`, handler);
          resolve();
        }
      };
      this.eventHook.addLocalListener(`mq:emptyQueue:${queue}`, handler);
    });
  }

  /**
   * Like awaitEmptyQueue but resolves after timeoutMs even if the queue is
   * not empty yet. Used during navigation to avoid blocking the UI.
   */
  public async awaitEmptyQueueWithTimeout(
    queue: string,
    timeoutMs: number,
  ): Promise<void> {
    if (await this.isQueueEmpty(queue)) {
      return;
    }
    await race([this.awaitEmptyQueue(queue), sleep(timeoutMs)]);
  }
}

import Dexie, { Table } from "dexie";
import { Message } from "$sb/mq.ts";

export type ProcessingMessage = Message & {
  ts: number;
};

export type SubscribeOptions = {
  batchSize?: number;
  pollInterval?: number;
};

export type QueueStats = {
  queued: number;
  processing: number;
  dlq: number;
};

export class DexieMQ {
  db: Dexie;
  queued: Table<Message, [string, string]>;
  processing: Table<ProcessingMessage, [string, string]>;
  dlq: Table<ProcessingMessage, [string, string]>;

  // queue -> set of run() functions
  localSubscriptions = new Map<string, Set<() => void>>();

  constructor(
    dbName: string,
    indexedDB?: any,
    IDBKeyRange?: any,
  ) {
    this.db = new Dexie(dbName, {
      indexedDB,
      IDBKeyRange,
    });
    this.db.version(1).stores({
      queued: "[queue+id], queue, id",
      processing: "[queue+id], queue, id, ts",
      dlq: "[queue+id], queue, id",
    });
    this.queued = this.db.table("queued");
    this.processing = this.db.table("processing");
    this.dlq = this.db.table("dlq");
  }

  // Internal sequencer for messages, only really necessary when batch sending tons of messages within a millisecond
  seq = 0;

  async batchSend(queue: string, bodies: any[]) {
    const messages = bodies.map((body) => ({
      id: `${Date.now()}-${String(++this.seq).padStart(6, "0")}`,
      queue,
      body,
    }));

    await this.queued.bulkAdd(messages);

    // See if we can immediately process the message with a local subscription
    const localSubscriptions = this.localSubscriptions.get(queue);
    if (localSubscriptions) {
      for (const run of localSubscriptions) {
        run();
      }
    }
  }

  send(queue: string, body: any) {
    return this.batchSend(queue, [body]);
  }

  poll(queue: string, maxItems: number): Promise<Message[]> {
    return this.db.transaction(
      "rw",
      [this.queued, this.processing],
      async (tx) => {
        const messages =
          (await tx.table<Message, [string, string]>("queued").where({ queue })
            .sortBy("id")).slice(0, maxItems);
        const ids: [string, string][] = messages.map((m) => [queue, m.id]);
        await tx.table("queued").bulkDelete(ids);
        await tx.table<ProcessingMessage, [string, string]>("processing")
          .bulkPut(
            messages.map((m) => ({
              ...m,
              ts: Date.now(),
            })),
          );
        return messages;
      },
    );
  }

  /**
   * @param queue
   * @param batchSize
   * @param callback
   * @returns a function to be called to unsubscribe
   */
  subscribe(
    queue: string,
    options: SubscribeOptions,
    callback: (messages: Message[]) => Promise<void> | void,
  ): () => void {
    let running = true;
    let timeout: number | undefined;
    const batchSize = options.batchSize || 1;
    const run = async () => {
      try {
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
        if (timeout) {
          clearTimeout(timeout);
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
    await this.processing.bulkDelete(ids.map((id) => [queue, id]));
  }

  async requeueTimeouts(
    timeout: number,
    maxRetries?: number,
    disableDLQ?: boolean,
  ) {
    const now = Date.now();
    const messages = await this.processing.where("ts").below(now - timeout)
      .toArray();
    const ids: [string, string][] = messages.map((m) => [m.queue, m.id]);
    await this.db.transaction(
      "rw",
      [this.queued, this.processing, this.dlq],
      async (tx) => {
        await tx.table("processing").bulkDelete(ids);
        const requeuedMessages: ProcessingMessage[] = [];
        const dlqMessages: ProcessingMessage[] = [];
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
              dlqMessages.push({
                queue: m.queue,
                id: m.id,
                body: m.body,
                ts: Date.now(),
                retries,
              });
            }
          } else {
            console.info("[mq]", "Message ack timed out, requeueing", m);
            requeuedMessages.push({
              ...m,
              retries,
            });
          }
        }
        await tx.table("queued").bulkPut(requeuedMessages);
        await tx.table("dlq").bulkPut(dlqMessages);
      },
    );
  }

  fetchDLQMessages(): Promise<ProcessingMessage[]> {
    return this.dlq.toArray();
  }

  fetchProcessingMessages(): Promise<ProcessingMessage[]> {
    return this.processing.toArray();
  }

  flushDLQ(): Promise<void> {
    return this.dlq.clear();
  }

  getQueueStats(queue: string): Promise<QueueStats> {
    return this.db.transaction(
      "r",
      [this.queued, this.processing, this.dlq],
      async (tx) => {
        const queued = await tx.table("queued").where({ queue }).count();
        const processing = await tx.table("processing").where({ queue })
          .count();
        const dlq = await tx.table("dlq").where({ queue }).count();
        return {
          queued,
          processing,
          dlq,
        };
      },
    );
  }

  async getAllQueueStats(): Promise<Record<string, QueueStats>> {
    const allStatus: Record<string, QueueStats> = {};
    await this.db.transaction(
      "r",
      [this.queued, this.processing, this.dlq],
      async (tx) => {
        for (const item of await tx.table("queued").toArray()) {
          if (!allStatus[item.queue]) {
            allStatus[item.queue] = {
              queued: 0,
              processing: 0,
              dlq: 0,
            };
          }
          allStatus[item.queue].queued++;
        }
        for (const item of await tx.table("processing").toArray()) {
          if (!allStatus[item.queue]) {
            allStatus[item.queue] = {
              queued: 0,
              processing: 0,
              dlq: 0,
            };
          }
          allStatus[item.queue].processing++;
        }
        for (const item of await tx.table("dlq").toArray()) {
          if (!allStatus[item.queue]) {
            allStatus[item.queue] = {
              queued: 0,
              processing: 0,
              dlq: 0,
            };
          }
          allStatus[item.queue].dlq++;
        }
      },
    );

    return allStatus;
  }
}

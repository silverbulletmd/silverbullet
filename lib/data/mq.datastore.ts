import {
  KV,
  MQMessage,
  MQStats,
  MQSubscribeOptions,
} from "../../plug-api/types.ts";
import { MessageQueue } from "./mq.ts";
import { DataStore } from "./datastore.ts";

export type ProcessingMessage = MQMessage & {
  ts: number;
};

const queuedPrefix = ["mq", "queued"];
const processingPrefix = ["mq", "processing"];
const dlqPrefix = ["mq", "dlq"];

export class DataStoreMQ implements MessageQueue {
  // queue -> set of run() functions
  localSubscriptions = new Map<string, Set<() => void>>();

  constructor(
    private ds: DataStore,
  ) {
  }

  // Internal sequencer for messages, only really necessary when batch sending tons of messages within a millisecond
  seq = 0;

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
    const messages = await this.ds.query<MQMessage>({
      prefix: [...queuedPrefix, queue],
      limit: ["number", maxItems],
    });
    if (messages.length === 0) {
      return [];
    }
    // Put them in the processing queue
    await this.ds.batchSet(
      messages.map((m) => ({
        key: [...processingPrefix, queue, m.value.id],
        value: {
          ...m.value,
          ts: Date.now(),
        },
      })),
    );
    // Delete them from the queued queue
    await this.ds.batchDelete(messages.map((m) => m.key));

    // Return them
    return messages.map((m) => m.value);
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
    const messages = await this.ds.query<ProcessingMessage>({
      prefix: processingPrefix,
      filter: ["<", ["attr", "ts"], ["number", now - timeout]],
    });
    if (messages.length === 0) {
      return;
    }
    await this.ds.batchDelete(messages.map((m) => m.key));
    const newMessages: KV<ProcessingMessage>[] = [];
    for (const { value: m } of messages) {
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
    return (await this.ds.query<ProcessingMessage>({ prefix: dlqPrefix })).map((
      { value },
    ) => value);
  }

  async fetchProcessingMessages(): Promise<ProcessingMessage[]> {
    return (await this.ds.query<ProcessingMessage>({
      prefix: processingPrefix,
    })).map((
      { value },
    ) => value);
  }

  flushDLQ(): Promise<void> {
    return this.ds.queryDelete({ prefix: dlqPrefix });
  }

  async getQueueStats(queue: string): Promise<MQStats> {
    const queued =
      (await (this.ds.query({ prefix: [...queuedPrefix, queue] }))).length;
    const processing =
      (await (this.ds.query({ prefix: [...processingPrefix, queue] }))).length;
    const dlq =
      (await (this.ds.query({ prefix: [...dlqPrefix, queue] }))).length;
    return {
      queued,
      processing,
      dlq,
    };
  }

  async getAllQueueStats(): Promise<Record<string, MQStats>> {
    const allStatus: Record<string, MQStats> = {};
    for (
      const { value: message } of await this.ds.query<MQMessage>({
        prefix: queuedPrefix,
      })
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
      const { value: message } of await this.ds.query<MQMessage>({
        prefix: processingPrefix,
      })
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
      const { value: message } of await this.ds.query<MQMessage>({
        prefix: dlqPrefix,
      })
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

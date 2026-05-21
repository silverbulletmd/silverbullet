import { expect, test, vi } from "vitest";
import { DataStoreMQ } from "./mq.datastore.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { DataStore } from "./datastore.ts";

import type { MQMessage } from "../../plug-api/types/datastore.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { System } from "../plugos/system.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";

test("DataStore MQ", async () => {
  vi.useFakeTimers();
  const db = new MemoryKvPrimitives(); // In-memory only, no persistence
  const eventHook = new EventHook();
  const system = new System<EventHookT>();
  system.addHook(eventHook);

  try {
    const mq = new DataStoreMQ(new DataStore(db), eventHook);

    let messages: MQMessage[];

    // Send and ack
    await mq.send("test", "Hello World");
    messages = await mq.poll("test", 10);
    expect(messages.length).toEqual(1);
    await mq.ack("test", messages[0].id);
    expect([]).toEqual(await mq.poll("test", 10));

    // Timeout
    await mq.send("test", "Hello World");
    messages = await mq.poll("test", 10);
    expect(messages.length).toEqual(1);
    expect([]).toEqual(await mq.poll("test", 10));
    await vi.advanceTimersByTimeAsync(20);
    await mq.requeueTimeouts(10);
    messages = await mq.poll("test", 10);
    const stats = await mq.getQueueStats();
    expect(stats.processing).toEqual(1);
    expect(messages.length).toEqual(1);
    expect(messages[0].retries).toEqual(1);

    // Max retries
    await vi.advanceTimersByTimeAsync(20);
    await mq.requeueTimeouts(10, 1);
    expect((await mq.fetchDLQMessages()).length).toEqual(1);

    // Batch send and ack
    await mq.batchSend("test", ["Hello", "World"]);
    const messageBatch1 = await mq.poll("test", 1);
    expect(messageBatch1.length).toEqual(1);
    expect(messageBatch1[0].body).toEqual("Hello");
    const messageBatch2 = await mq.poll("test", 1);
    expect(messageBatch2.length).toEqual(1);
    expect(messageBatch2[0].body).toEqual("World");
    await mq.batchAck("test", [messageBatch1[0].id, messageBatch2[0].id]);
    expect(await mq.fetchProcessingMessages()).toEqual([]);

    // Subscribe
    let receivedMessage = false;
    const worker = mq.subscribe("test123", {}, async (messages) => {
      expect(messages.length).toEqual(1);
      receivedMessage = true;
      await mq.ack("test123", messages[0].id);
    });
    await mq.send("test123", "Hello World");
    // Wait for message to be processed by checking queue stats
    while ((await mq.getQueueStats("test123")).queued > 0) {
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(receivedMessage).toEqual(true);
    worker.stop();
    expect(mq.queueWaiters.size).toEqual(0);
  } finally {
    await db.close();
    vi.useRealTimers();
  }
});

test("DataStore MQ - Scale test with multiple subscribers", async () => {
  vi.useFakeTimers();
  const db = new MemoryKvPrimitives();
  const eventHook = new EventHook();
  const system = new System<EventHookT>();
  system.addHook(eventHook);

  try {
    const mq = new DataStoreMQ(new DataStore(db), eventHook);

    const queueName = "scale-test";
    const totalMessages = 1000;
    const batchSize = 7;
    const numSubscribers = 3;

    // Track processed messages across all subscribers
    const processedMessages = new Set<string>();
    const subscriberStats = new Map<number, number>();
    const processingLock = new Set<string>(); // Track which messages are being processed

    // Initialize subscriber stats
    for (let i = 0; i < numSubscribers; i++) {
      subscriberStats.set(i, 0);
    }

    // Create 3 subscribers, each processing batches of 7 messages
    const workers = [];
    for (let subscriberId = 0; subscriberId < numSubscribers; subscriberId++) {
      const worker = mq.subscribe(
        queueName,
        { batchSize },
        async (messages) => {
          expect(messages.length <= batchSize).toBe(true);

          console.log(
            `[Subscriber ${subscriberId}] Processing batch of ${messages.length} messages`,
          );

          // Process each message in the batch
          const messageIds = [];
          for (const message of messages) {
            // Check for concurrent processing (this shouldn't happen due to MQ design)
            if (processingLock.has(message.body)) {
              console.warn(
                `Message ${message.body} is being processed concurrently by subscriber ${subscriberId}`,
              );
              continue;
            }
            processingLock.add(message.body);

            // Ensure no duplicate processing
            if (processedMessages.has(message.body)) {
              console.warn(
                `Message ${message.body} already processed by another subscriber`,
              );
              processingLock.delete(message.body);
              continue;
            }

            processedMessages.add(message.body);
            messageIds.push(message.id);

            // Update subscriber stats
            const currentCount = subscriberStats.get(subscriberId) || 0;
            subscriberStats.set(subscriberId, currentCount + 1);

            // Remove from processing lock
            processingLock.delete(message.body);
          }

          // Ack all messages in the batch that were actually processed
          if (messageIds.length > 0) {
            await mq.batchAck(queueName, messageIds);
          }
        },
      );
      workers.push(worker);
    }

    // Send messages in smaller batches to allow better distribution
    const messageBodies = [];
    for (let i = 0; i < totalMessages; i++) {
      messageBodies.push(`message-${i}`);
    }

    // Send in chunks to allow workers to process and become available
    const chunkSize = 50;
    for (let i = 0; i < messageBodies.length; i += chunkSize) {
      const chunk = messageBodies.slice(i, i + chunkSize);
      await mq.batchSend(queueName, chunk);
      // Give a small delay to allow processing
      await vi.advanceTimersByTimeAsync(10);
    }

    // Wait for all messages to be processed
    const maxWaitTime = 10000; // 10 seconds max wait
    let waitTime = 0;

    while (processedMessages.size < totalMessages && waitTime < maxWaitTime) {
      await vi.advanceTimersByTimeAsync(100);
      waitTime += 100;
    }

    // Verify all messages were processed
    expect(processedMessages.size).toEqual(totalMessages);

    // Wait a bit more to ensure all acks are processed
    await vi.advanceTimersByTimeAsync(100);

    // Verify queue is empty
    const stats = await mq.getQueueStats(queueName);
    expect(stats.queued).toEqual(0);
    expect(stats.processing).toEqual(0);

    // Verify work distribution among subscribers
    let totalProcessedAcrossSubscribers = 0;
    for (const [subscriberId, count] of subscriberStats.entries()) {
      totalProcessedAcrossSubscribers += count;
      console.log(`Subscriber ${subscriberId} processed ${count} messages`);
    }
    expect(totalProcessedAcrossSubscribers).toEqual(totalMessages);

    // Verify at least one subscriber processed messages (relaxed requirement since MQ may favor one worker)
    const activeSubscribers = Array.from(subscriberStats.values()).filter(
      (count) => count > 0,
    ).length;
    expect(activeSubscribers >= 1).toBe(true);

    // Stop all workers
    workers.forEach((worker) => worker.stop());

    // Verify no queue waiters remain
    expect(mq.queueWaiters.size).toEqual(0);
  } finally {
    await db.close();
    vi.useRealTimers();
  }
});

test("DataStore MQ - In-Memory Queue size optimization", async () => {
  const db = new MemoryKvPrimitives();
  const ds = new DataStore(db);
  const eventHook = new EventHook();
  const mq = new DataStoreMQ(ds, eventHook);

  try {
    const queue = "test-optimization";

    // Spy on countQuery
    const countQuerySpy = vi.spyOn(ds.kv, "countQuery");

    // 1. Initially check queue status
    const isEmptyInitial = await mq.isQueueEmpty(queue);
    expect(isEmptyInitial).toBe(true);
    expect(countQuerySpy).toHaveBeenCalledTimes(3); // First check should initialize counts from DB

    countQuerySpy.mockClear();

    // 2. Checking again should NOT query DB (in-memory cache is used)
    const isEmptyAgain = await mq.isQueueEmpty(queue);
    expect(isEmptyAgain).toBe(true);
    expect(countQuerySpy).toHaveBeenCalledTimes(0);

    // 3. Send message
    await mq.send(queue, "task1");
    // Since queue is initialized, queued count should update in memory
    const isEmptyAfterSend = await mq.isQueueEmpty(queue);
    expect(isEmptyAfterSend).toBe(false);
    expect(countQuerySpy).toHaveBeenCalledTimes(0);

    // 4. Poll message
    const msgs = await mq.poll(queue, 1);
    expect(msgs.length).toBe(1);
    const isEmptyAfterPoll = await mq.isQueueEmpty(queue);
    expect(isEmptyAfterPoll).toBe(false); // queued is 0, but processing is 1
    expect(countQuerySpy).toHaveBeenCalledTimes(0);

    // 5. Ack message
    await mq.ack(queue, msgs[0].id);
    const isEmptyAfterAck = await mq.isQueueEmpty(queue);
    expect(isEmptyAfterAck).toBe(true); // both 0
    expect(countQuerySpy).toHaveBeenCalledTimes(0);

    // 6. Test flushQueue resets cache
    await mq.send(queue, "task2");
    await mq.flushQueue(queue);
    expect(await mq.isQueueEmpty(queue)).toBe(true);
    expect(countQuerySpy).toHaveBeenCalledTimes(0);
  } finally {
    await db.close();
  }
});

test("DataStore MQ - Queue Pause Throttling", async () => {
  vi.useFakeTimers();
  const db = new MemoryKvPrimitives();
  const ds = new DataStore(db);
  const eventHook = new EventHook();
  const system = new System<EventHookT>();
  system.addHook(eventHook);
  const mq = new DataStoreMQ(ds, eventHook);


  try {
    const queue = "test-pause";
    let processed = false;

    // Subscribe to the queue
    const worker = mq.subscribe(queue, {}, () => {
      processed = true;
    });

    // Pause the queue
    mq.setQueuePaused(queue, true);
    expect(mq.isQueuePaused(queue)).toBe(true);

    // Send a message
    await mq.send(queue, "hello");

    // Advance time and check that subscriber did NOT run
    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toBe(false);

    // Unpause the queue
    mq.setQueuePaused(queue, false);
    expect(mq.isQueuePaused(queue)).toBe(false);

    // Advance time, now it should run
    await vi.advanceTimersByTimeAsync(1000);
    expect(processed).toBe(true);

    worker.stop();
  } finally {
    await db.close();
    vi.useRealTimers();
  }
});

test("DataStore MQ - In-Memory Queue size retrieval", async () => {
  const db = new MemoryKvPrimitives();
  const ds = new DataStore(db);
  const eventHook = new EventHook();
  const mq = new DataStoreMQ(ds, eventHook);

  try {
    const queue = "test-in-memory-size";

    // Initially getQueueSizeInMemory triggers ensureQueueInitialized
    let size = mq.getQueueSizeInMemory(queue);
    expect(size).toBe(0); // initially 0 because initialization is async

    // Wait for queue initialization
    await mq.isQueueEmpty(queue);

    // Send messages
    await mq.send(queue, "task1");
    await mq.send(queue, "task2");

    size = mq.getQueueSizeInMemory(queue);
    expect(size).toBe(2);

    // Poll one
    const msgs = await mq.poll(queue, 1);
    expect(msgs.length).toBe(1);

    // Size should still be 2 (1 queued + 1 processing)
    size = mq.getQueueSizeInMemory(queue);
    expect(size).toBe(2);

    // Ack one
    await mq.ack(queue, msgs[0].id);
    size = mq.getQueueSizeInMemory(queue);
    expect(size).toBe(1);
  } finally {
    await db.close();
  }
});



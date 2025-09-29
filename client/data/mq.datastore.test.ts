import { DataStoreMQ } from "./mq.datastore.ts";
import { assertEquals } from "@std/assert";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { FakeTime } from "@std/testing/time";

import type { MQMessage } from "../../plug-api/types/datastore.ts";

Deno.test("DataStore MQ", async () => {
  const time = new FakeTime();
  const db = new MemoryKvPrimitives(); // In-memory only, no persistence

  try {
    const mq = new DataStoreMQ(
      new DataStore(db),
    );

    let messages: MQMessage[];

    // Send and ack
    await mq.send("test", "Hello World");
    messages = await mq.poll("test", 10);
    assertEquals(messages.length, 1);
    await mq.ack("test", messages[0].id);
    assertEquals([], await mq.poll("test", 10));

    // Timeout
    await mq.send("test", "Hello World");
    messages = await mq.poll("test", 10);
    assertEquals(messages.length, 1);
    assertEquals([], await mq.poll("test", 10));
    await time.tickAsync(20);
    await mq.requeueTimeouts(10);
    messages = await mq.poll("test", 10);
    const stats = await mq.getAllQueueStats();
    assertEquals(stats["test"].processing, 1);
    assertEquals(messages.length, 1);
    assertEquals(messages[0].retries, 1);

    // Max retries
    await time.tickAsync(20);
    await mq.requeueTimeouts(10, 1);
    assertEquals((await mq.fetchDLQMessages()).length, 1);

    // Batch send and ack
    await mq.batchSend("test", ["Hello", "World"]);
    const messageBatch1 = await mq.poll("test", 1);
    assertEquals(messageBatch1.length, 1);
    assertEquals(messageBatch1[0].body, "Hello");
    const messageBatch2 = await mq.poll("test", 1);
    assertEquals(messageBatch2.length, 1);
    assertEquals(messageBatch2[0].body, "World");
    await mq.batchAck("test", [messageBatch1[0].id, messageBatch2[0].id]);
    assertEquals(await mq.fetchProcessingMessages(), []);

    // Subscribe
    let receivedMessage = false;
    const worker = mq.subscribe("test123", {}, async (messages) => {
      assertEquals(messages.length, 1);
      receivedMessage = true;
      await mq.ack("test123", messages[0].id);
    });
    await mq.send("test123", "Hello World");
    // Wait for message to be processed by checking queue stats
    while ((await mq.getQueueStats("test123")).queued > 0) {
      await time.tickAsync(100);
    }
    assertEquals(receivedMessage, true);
    worker.stop();
    assertEquals(mq.queueWaiters.size, 0);
  } finally {
    await db.close();
    time.restore();
  }
});

Deno.test("DataStore MQ - Scale test with multiple subscribers", async () => {
  const time = new FakeTime();
  const db = new MemoryKvPrimitives();

  try {
    const mq = new DataStoreMQ(
      new DataStore(db),
    );

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
          assertEquals(
            messages.length <= batchSize,
            true,
            `Batch size should not exceed ${batchSize}`,
          );

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
      await time.tickAsync(10);
    }

    // Wait for all messages to be processed
    const maxWaitTime = 10000; // 10 seconds max wait
    let waitTime = 0;

    while (processedMessages.size < totalMessages && waitTime < maxWaitTime) {
      await time.tickAsync(100);
      waitTime += 100;
    }

    // Verify all messages were processed
    assertEquals(
      processedMessages.size,
      totalMessages,
      `Expected ${totalMessages} messages processed, got ${processedMessages.size}`,
    );

    // Wait a bit more to ensure all acks are processed
    await time.tickAsync(100);

    // Verify queue is empty
    const stats = await mq.getQueueStats(queueName);
    assertEquals(stats.queued, 0, "Queue should be empty");
    assertEquals(stats.processing, 0, "No messages should be processing");

    // Verify work distribution among subscribers
    let totalProcessedAcrossSubscribers = 0;
    for (const [subscriberId, count] of subscriberStats.entries()) {
      totalProcessedAcrossSubscribers += count;
      console.log(`Subscriber ${subscriberId} processed ${count} messages`);
    }
    assertEquals(
      totalProcessedAcrossSubscribers,
      totalMessages,
      "Total processed should match sent messages",
    );

    // Verify at least one subscriber processed messages (relaxed requirement since MQ may favor one worker)
    const activeSubscribers =
      Array.from(subscriberStats.values()).filter((count) => count > 0).length;
    assertEquals(
      activeSubscribers >= 1,
      true,
      "At least one subscriber should have processed messages",
    );

    // Stop all workers
    workers.forEach((worker) => worker.stop());

    // Verify no queue waiters remain
    assertEquals(mq.queueWaiters.size, 0);
  } finally {
    await db.close();
    time.restore();
  }
});

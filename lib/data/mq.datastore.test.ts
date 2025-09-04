import { DataStoreMQ } from "./mq.datastore.ts";
import { assertEquals } from "@std/assert";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { PrefixedKvPrimitives } from "./prefixed_kv_primitives.ts";
import { FakeTime } from "@std/testing/time";

import type { MQMessage } from "../../type/datastore.ts";

Deno.test("DataStore MQ", async () => {
  const time = new FakeTime();
  const db = new MemoryKvPrimitives(); // In-memory only, no persistence

  try {
    const mq = new DataStoreMQ(
      new DataStore(new PrefixedKvPrimitives(db, ["mq"])),
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

    // Subscribe
    let receivedMessage = false;
    const unsubscribe = mq.subscribe("test123", {}, async (messages) => {
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
    unsubscribe();

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
  } finally {
    await db.close();
    time.restore();
  }
});

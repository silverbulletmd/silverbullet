import { DataStoreMQ } from "./mq.dataStore.ts";
import { assertEquals } from "../../test_deps.ts";
import { sleep } from "$sb/lib/async.ts";
import { DenoKvPrimitives } from "./deno_kv_primitives.ts";
import { DataStore } from "./dataStore.ts";

Deno.test("DataStore MQ", async () => {
  const tmpFile = await Deno.makeTempFile();
  const db = new DenoKvPrimitives(await Deno.openKv(tmpFile));

  const mq = new DataStoreMQ(new DataStore(db));
  await mq.send("test", "Hello World");
  let messages = await mq.poll("test", 10);
  assertEquals(messages.length, 1);
  await mq.ack("test", messages[0].id);
  assertEquals([], await mq.poll("test", 10));
  await mq.send("test", "Hello World");
  messages = await mq.poll("test", 10);
  assertEquals(messages.length, 1);
  assertEquals([], await mq.poll("test", 10));
  await sleep(20);
  await mq.requeueTimeouts(10);
  messages = await mq.poll("test", 10);
  const stats = await mq.getAllQueueStats();
  assertEquals(stats["test"].processing, 1);
  assertEquals(messages.length, 1);
  assertEquals(messages[0].retries, 1);
  await sleep(20);
  await mq.requeueTimeouts(10, 1);
  assertEquals((await mq.fetchDLQMessages()).length, 1);

  let receivedMessage = false;
  const unsubscribe = mq.subscribe("test123", {}, async (messages) => {
    assertEquals(messages.length, 1);
    await mq.ack("test123", messages[0].id);
    receivedMessage = true;
  });
  mq.send("test123", "Hello World");
  // Give time to process the message
  await sleep(1);
  assertEquals(receivedMessage, true);
  unsubscribe();

  // Batch send
  await mq.batchSend("test", ["Hello", "World"]);
  const messageBatch1 = await mq.poll("test", 1);
  assertEquals(messageBatch1.length, 1);
  assertEquals(messageBatch1[0].body, "Hello");
  const messageBatch2 = await mq.poll("test", 1);
  assertEquals(messageBatch2.length, 1);
  assertEquals(messageBatch2[0].body, "World");

  await mq.batchAck("test", [messageBatch1[0].id, messageBatch2[0].id]);
  assertEquals(await mq.fetchProcessingMessages(), []);
  // Give time to close the db
  await sleep(20);

  db.close();
  await Deno.remove(tmpFile);
});

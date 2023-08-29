import { sleep } from "$sb/lib/async.ts";
import { DenoKvMQ } from "./mq.deno_kv.ts";

Deno.test("Deno MQ", async () => {
  const denoKv = await Deno.openKv("test.db");
  const mq = new DenoKvMQ(denoKv);
  const unsub = mq.subscribe("test", {}, (messages) => {
    console.log("Received on test", messages);
  });
  const unsub2 = mq.subscribe("test2", {}, (messages) => {
    console.log("Received on test2", messages);
  });
  await mq.send("test", "Hello World");
  await mq.batchSend("test2", ["Hello World 2", "Hello World 3"]);

  // Let's avoid a panic here
  await sleep(20);
  denoKv.close();
  await Deno.remove("test.db");
});

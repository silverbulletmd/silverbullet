import {
  editor,
  events,
  markdown,
  mq,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { sleep } from "../../lib/async.ts";
import type { MQMessage } from "../../plug-api/types/datastore.ts";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { clearFileIndex } from "./api.ts";

export async function reindexSpace() {
  if (await system.getMode() === "ro") {
    console.info("Not reindexing because we're in read-only mode");
    return;
  }
  console.log("Clearing page index...");
  await system.invokeFunction("index.clearIndex");

  const startTime = Date.now();

  const files = await space.listFiles();

  console.log("Queing", files.length, "pages to be indexed.");
  // Queue all file names to be indexed
  await mq.batchSend("indexQueue", files.map((file) => file.name));
  await editor.showProgress(0, "index");
  await mq.awaitEmptyQueue("indexQueue");

  // And notify the user
  console.log(`Indexing completed in ${(Date.now() - startTime) / 1000}s`);
  await editor.showProgress();
}

setTimeout(updateIndexProgressInUI, 5000);

async function updateIndexProgressInUI() {
  // Let's see if there's anything in the index queue
  let queueStats = await mq.getQueueStats("indexQueue");
  if (queueStats.queued > 0 || queueStats.processing > 0) {
    // Something's queued, likely it makes sense to compare this to the total number of files (progress wise)
    const fileList = await space.listFiles();
    while (queueStats.queued > 0 || queueStats.processing > 0) {
      queueStats = await mq.getQueueStats("indexQueue");
      const percentage = Math.round(
        (fileList.length - queueStats.queued) / fileList.length * 100,
      );
      if (percentage > 99) {
        // Hide progress circle
        await editor.showProgress();
      } else {
        await editor.showProgress(percentage, "index");
      }
      // Update UI every second
      await sleep(1000);
    }
  }
  // Schedule again
  setTimeout(updateIndexProgressInUI, 5000);
}

export async function processIndexQueue(messages: MQMessage[]) {
  for (const message of messages) {
    let name: string = message.body;
    if (name.startsWith("_plug/")) {
      continue;
    }
    console.log(`Indexing file ${name}`);
    if (name.endsWith(".md")) {
      name = name.slice(0, -3);
      await indexPage(name);
    } else {
      await events.dispatchEvent("document:index", name);
    }
  }
}

async function indexPage(name: string) {
  // Clear any previous index entries for this file
  await clearFileIndex(name);
  // Read and parse the file
  const text = await space.readPage(name);
  const parsed = await markdown.parseMarkdown(text);

  // Emit the event which will be picked up by indexers
  await events.dispatchEvent("page:index", {
    name,
    tree: parsed,
  } as IndexTreeEvent);
}

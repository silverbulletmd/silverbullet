import {
  editor,
  events,
  markdown,
  mq,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import type { MQMessage } from "@silverbulletmd/silverbullet/type/datastore";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";

const uiUpdateInterval = 5000;

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
  await mq.batchSend("preIndexQueue", files.map((file) => file.name));
  await mq.batchSend("indexQueue", files.map((file) => file.name));
  await editor.showProgress(0, "index");
  // We'll assume this one completes last
  await mq.awaitEmptyQueue("indexQueue");

  // And notify the user
  console.log(`Indexing completed in ${(Date.now() - startTime) / 1000}s`);
  await editor.showProgress();
}

setTimeout(updateIndexProgressInUI, uiUpdateInterval);

async function totalItemsQueued() {
  const queueStats = await mq.getQueueStats();
  return queueStats.queued + queueStats.processing;
}

async function updateIndexProgressInUI() {
  // Let's see if there's anything in the index queue
  let totalQueued = await totalItemsQueued();
  if (totalQueued > 0) {
    // Something's queued, likely it makes sense to compare this to the total number of files (progress wise)
    const fileList = await space.listFiles();
    while (totalQueued > 0) {
      totalQueued = await totalItemsQueued();
      let percentage = Math.round(
        (fileList.length - totalQueued) / fileList.length * 100,
      );
      if (percentage < 0) {
        // The assumption that the queue size is related tot he file list length turns out to be wrong
        // // Let's show some sort of number
        percentage = 67;
      }
      if (percentage > 99) {
        // Hide progress circle
        await editor.showProgress();
      } else {
        await editor.showProgress(percentage, "index");
      }
      await sleep(1000);
    }
  }
  // Schedule again
  setTimeout(updateIndexProgressInUI, uiUpdateInterval);
}

export async function processIndexQueue(messages: MQMessage[]) {
  for (const message of messages) {
    const path: string = message.body;
    console.log("[index]", `Indexing file ${path}`);
    await indexFile(path);
  }
}

async function indexFile(path: string) {
  if (path.endsWith(".md")) {
    // Page
    const name = path.slice(0, -3);
    // Read and parse the file
    const text = await space.readPage(name);
    const tree = await markdown.parseMarkdown(text);

    // Emit the event which will be picked up by indexers
    await events.dispatchEvent("page:index", {
      name,
      tree,
    } as IndexTreeEvent);
  }
}

export async function processPreIndexQueue(messages: MQMessage[]) {
  for (const message of messages) {
    const path: string = message.body;
    console.log("[pre-index]", `Pre-indexing file ${path}`);
    await preIndexFile(path);
  }
}

async function preIndexFile(path: string) {
  if (path.endsWith(".md")) {
    // Page
    const name = path.slice(0, -3);
    // Read file
    const text = await space.readPage(name);
    const tree = await markdown.parseMarkdown(text);

    // Emit the event which will be picked up by indexers
    await events.dispatchEvent("page:preindex", {
      name,
      tree,
    } as IndexTreeEvent);
  } else {
    await events.dispatchEvent("document:index", path);
  }
}

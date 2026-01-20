import {
  editor,
  events,
  markdown,
  mq,
  space,
} from "@silverbulletmd/silverbullet/syscalls";
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import type { MQMessage } from "@silverbulletmd/silverbullet/type/datastore";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";

const uiUpdateInterval = 5000;

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
    const { text, meta } = await space.readPageWithMeta(name);
    const tree = await markdown.parseMarkdown(text);

    // Emit the event which will be picked up by indexers
    await events.dispatchEvent("page:index", {
      name,
      meta,
      tree,
      text,
    } as IndexTreeEvent);
  } else {
    await events.dispatchEvent("document:index", path);
  }
}

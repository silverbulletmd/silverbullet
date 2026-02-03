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

/// QUEUE PROCESSING

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

/// UI PROGRESS UPDATE LOGIC

const uiUpdateInterval = 5000;

// There is no reliable way to know the total number of queue items, so we'll keep track of the maximum observed queue size
// and use that to calculate the progress percentage.
let maximumObservedQueueSize = 0;

setTimeout(updateIndexProgressInUI, uiUpdateInterval);

// Returns the total number of items queued, updating the maximum observed queue size if necessary
async function totalItemsQueued() {
  const queueStats = await mq.getQueueStats();
  const total = queueStats.queued + queueStats.processing;
  if (total > maximumObservedQueueSize) {
    maximumObservedQueueSize = total;
  } else if (total === 0) {
    // Empty queue, let's reset the maximum observed queue size
    maximumObservedQueueSize = 0;
  }
  return total;
}

async function updateIndexProgressInUI() {
  // Let's see if there's anything in the index queue
  let totalQueued = await totalItemsQueued();
  while (totalQueued > 0) {
    const percentage = Math.round(
      (maximumObservedQueueSize - totalQueued) / maximumObservedQueueSize * 100,
    );
    if (percentage > 0 && percentage <= 99) {
      await editor.showProgress(percentage, "index");
    } else {
      // Hide progress circle
      await editor.showProgress();
    }
    await sleep(1000);
    totalQueued = await totalItemsQueued();
  }
  // Schedule again
  setTimeout(updateIndexProgressInUI, uiUpdateInterval);
}

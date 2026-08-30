import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import {
  editor,
  events,
  index,
  markdown,
  mq,
  space,
  sync,
} from "@silverbulletmd/silverbullet/syscalls";
import type {
  IndexQueueBody,
  MQMessage,
} from "@silverbulletmd/silverbullet/type/datastore";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";

/// QUEUE PROCESSING

export async function processIndexQueue(messages: MQMessage[]) {
  // During a fresh install's initial index, defer files the sync engine
  // hasn't delivered yet: indexing them now would re-download them through
  // the proxy, racing the sync engine for connections. On fast links sync
  // stays ahead and nothing defers; on slow links indexing throttles to
  // sync pace.
  const ready: MQMessage[] = [];
  const requeue: IndexQueueBody[] = [];
  const readiness = await sync.areFilesReadyToIndex(
    messages.map((message) => {
      const body: IndexQueueBody = message.body;
      return typeof body === "string" ? body : body.path;
    }),
  );
  messages.forEach((message, i) => {
    if (readiness[i]) {
      ready.push(message);
    } else {
      requeue.push(message.body);
    }
  });
  if (ready.length === 0 && requeue.length > 0) {
    // The whole batch is waiting on sync — back off instead of spinning
    // through the queue
    await sleep(1000);
  }

  // Failures are isolated per file: a rejected batch would never be acked,
  // wedging its messages in "processing" where the requeue cron duplicates
  // work that is still in flight. Instead the batch always completes, and
  // failed files are explicitly re-queued a bounded number of times.
  const results = await Promise.allSettled(
    ready.map((message) => {
      const body: IndexQueueBody = message.body;
      const path = typeof body === "string" ? body : body.path;
      console.log("[index]", `Indexing file ${path}`);
      return indexFile(path, typeof body !== "string" && body.cleared === true);
    }),
  );
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== "rejected") {
      continue;
    }
    const body: IndexQueueBody = ready[i].body;
    const path = typeof body === "string" ? body : body.path;
    const attempts = (typeof body === "string" ? 0 : (body.attempts ?? 0)) + 1;
    if (attempts >= 3) {
      console.error(
        "[index]",
        `Giving up on ${path} after ${attempts} attempts:`,
        result.reason?.message,
      );
    } else {
      console.warn(
        "[index]",
        `Failed to index ${path} (attempt ${attempts}), re-queueing:`,
        result.reason?.message,
      );
      requeue.push({ path, attempts });
    }
  }
  if (requeue.length > 0) {
    await mq.batchSend("indexQueue", requeue);
  }
}

async function indexFile(path: string, alreadyCleared: boolean) {
  // Indexing writes on top of whatever is already stored, so the file's
  // previous entries are dropped here, on the way out of the queue, rather
  // than by whoever put it in. Every route into the queue then replaces
  // rather than accumulates.
  if (!alreadyCleared) {
    await index.clearFileIndex(path);
  }
  if (path.endsWith(".md")) {
    // Page
    const name = path.slice(0, -3);
    let text: string, meta: any;
    try {
      ({ text, meta } = await space.readPageWithMeta(name));
    } catch (e: any) {
      if (e.message === notFoundError.message) {
        console.info("[index]", `Skipping ${path}, no longer exists`);
        return;
      }
      throw e;
    }
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
  let lastProgress = -1;
  let lastProgressAt = 0;
  while (totalQueued > 0) {
    const percentage = Math.round(
      ((maximumObservedQueueSize - totalQueued) / maximumObservedQueueSize) *
        100,
    );
    if (percentage > 0 && percentage <= 99) {
      const now = Date.now();
      if (lastProgress !== percentage || now - lastProgressAt >= 1000) {
        lastProgress = percentage;
        lastProgressAt = now;
        await editor.showProgress("index", percentage);
      }
    } else {
      await editor.hideProgress("index");
      lastProgressAt = 0;
    }
    await sleep(40);
    totalQueued = await totalItemsQueued();
  }
  await editor.hideProgress("index");
  // Schedule again
  setTimeout(updateIndexProgressInUI, uiUpdateInterval);
}

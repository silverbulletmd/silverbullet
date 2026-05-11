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
import { hasAnyFence } from "../../client/lib/fence_detector.ts";

const PASS1_FENCE_TYPES = ["space-lua", "space-style"] as const;

/// QUEUE PROCESSING

export async function processIndexQueue(messages: MQMessage[]) {
  const fileContents = (
    await Promise.all(
      messages.map(async (message) => {
        const path: string = message.body;
        if (!path.endsWith(".md")) {
          return {
            path,
            kind: "document" as const,
            text: "",
            meta: null,
            tree: null,
          };
        }
        const name = path.slice(0, -3);
        try {
          const { text, meta } = await space.readPageWithMeta(name);
          if (!meta) {
            console.warn(`[index] Skipping "${path}": could not read page meta`);
            return null;
          }
          const tree = await markdown.parseMarkdown(text);
          return { path, kind: "page" as const, name, text, meta, tree };
        } catch (e: any) {
          console.error(`[index] Could not read "${path}": ${e?.message ?? e}`);
          return null;
        }
      }),
    )
  ).filter((f) => f !== null);

  for (const file of fileContents) {
    if (file.kind === "document") {
      await events.dispatchEvent("document:index", file.path);
    } else {
      await events.dispatchEvent("page:index", {
        name: file.name,
        meta: file.meta,
        tree: file.tree,
        text: file.text,
      } as IndexTreeEvent);
    }
  }
}

export async function processIndexQueuePass1(messages: MQMessage[]) {
  const fileContents = await Promise.all(
    messages.map(async (message) => {
      const path: string = message.body;
      if (!path.endsWith(".md")) {
        return null;
      }
      const name = path.slice(0, -3);
      try {
        const { text, meta } = await space.readPageWithMeta(name);
        if (!meta) {
          console.warn(`[index] Skipping "${path}" (Pass-1): could not read page meta`);
          return null;
        }
        if (!hasAnyFence(text, PASS1_FENCE_TYPES)) {
          return null;
        }
        const tree = await markdown.parseMarkdown(text);
        return { path, name, text, meta, tree };
      } catch (e: any) {
        console.error(`[index] Could not read "${path}" (Pass-1): ${e?.message ?? e}`);
        return null;
      }
    }),
  );

  for (const file of fileContents) {
    if (!file) continue;
    await events.dispatchEvent("page:indexPass1", {
      name: file.name,
      meta: file.meta,
      tree: file.tree,
      text: file.text,
    } as IndexTreeEvent);
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
      ((maximumObservedQueueSize - totalQueued) / maximumObservedQueueSize) *
        100,
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

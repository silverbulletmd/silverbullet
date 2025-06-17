import {
  editor,
  events,
  markdown,
  mq,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { IndexEvent } from "../../type/event.ts";
import { sleep } from "../../lib/async.ts";
import { indexDocument } from "./document.ts";
import { clearFileIndex } from "./api.ts";
import type { MQMessage } from "../../type/datastore.ts";

export async function reindexCommand() {
  await editor.flashNotification("Performing full page reindex...");
  await system.invokeFunction("index.reindexSpace");
  await editor.flashNotification("Done with page index!");
}

export async function reindexSpace() {
  if (await system.getMode() === "ro") {
    console.info("Not reindexing because we're in read-only mode");
    return;
  }
  console.log("Clearing page index...");
  await system.invokeFunction("index.clearIndex");

  const files = await space.listFiles();

  console.log("Queing", files.length, "pages to be indexed.");
  // Queue all file names to be indexed
  await mq.batchSend("indexQueue", files.map((file) => file.name));
  await editor.showProgress(0, "index");

  // Now let's wait for the processing to finish
  let queueStats = await mq.getQueueStats("indexQueue");
  while (queueStats.queued > 0 || queueStats.processing > 0) {
    await sleep(500);
    queueStats = await mq.getQueueStats("indexQueue");
    await editor.showProgress(
      100 - Math.round(queueStats.queued / files.length * 100),
      "index",
    );
  }
  // And notify the user
  console.log("Indexing completed!");
  await editor.showProgress();
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
      await indexDocument(name);
    }
  }
}

async function indexPage(name: string) {
  const text = await space.readPage(name);
  const parsed = await markdown.parseMarkdown(text);
  await events.dispatchEvent("page:index", {
    name,
    tree: parsed,
  });
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  if (await system.getMode() === "ro") {
    console.info("Not reindexing", name, "because we're in read-only mode");
    return;
  }
  const parsed = await markdown.parseMarkdown(text);

  // First clear the old file index entries
  await clearFileIndex(name);

  // console.log("Indexing page", name);
  await events.dispatchEvent("page:index", {
    name,
    tree: parsed,
  });
}

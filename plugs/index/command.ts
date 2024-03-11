import { editor, events, markdown, mq, space, system } from "$sb/syscalls.ts";
import { IndexEvent } from "../../plug-api/types.ts";
import { MQMessage } from "../../plug-api/types.ts";
import { isTemplate } from "$lib/cheap_yaml.ts";
import { sleep } from "$lib/async.ts";

export async function reindexCommand() {
  await editor.flashNotification("Performing full page reindex...");
  await system.invokeFunction("index.reindexSpace");
  await editor.flashNotification("Done with page index!");
}

export async function reindexSpace(noClear = false) {
  if (await system.getMode() === "ro") {
    console.info("Not reindexing because we're in read-only mode");
    return;
  }
  if (!noClear) {
    console.log("Clearing page index...");
    // Executed this way to not have to embed the search plug code here
    await system.invokeFunction("index.clearIndex");
  }
  // Load builtins
  await system.invokeFunction("index.loadBuiltinsIntoIndex");

  const pages = await space.listPages();

  // Queue all page names to be indexed
  await mq.batchSend("indexQueue", pages.map((page) => page.name));

  // Now let's wait for the processing to finish
  let queueStats = await mq.getQueueStats("indexQueue");
  while (queueStats.queued > 0 || queueStats.processing > 0) {
    await sleep(500);
    queueStats = await mq.getQueueStats("indexQueue");
  }
  // And notify the user
  console.log("Indexing completed!");
}

export async function processIndexQueue(messages: MQMessage[]) {
  for (const message of messages) {
    const name: string = message.body;
    console.log(`Indexing page ${name}`);
    const text = await space.readPage(name);
    const parsed = await markdown.parseMarkdown(text);
    if (isTemplate(text)) {
      console.log("Indexing", name, "as template");
      await events.dispatchEvent("page:indexTemplate", {
        name,
        tree: parsed,
      });
    } else {
      await events.dispatchEvent("page:index", {
        name,
        tree: parsed,
      });
    }
  }
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  if (await system.getMode() === "ro") {
    console.info("Not reindexing", name, "because we're in read-only mode");
    return;
  }
  const parsed = await markdown.parseMarkdown(text);

  if (isTemplate(text)) {
    // console.log("Indexing", name, "as template");
    await events.dispatchEvent("page:indexTemplate", {
      name,
      tree: parsed,
    });
  } else {
    // console.log("Indexing", name, "as page");
    await events.dispatchEvent("page:index", {
      name,
      tree: parsed,
    });
  }
}

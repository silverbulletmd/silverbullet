import type { IndexEvent, IndexTreeEvent } from "$sb/app_event.ts";
import { editor, events, markdown, mq, space, system } from "$sb/syscalls.ts";

import type { MQMessage, PageMeta } from "$sb/types.ts";
import { sleep } from "$sb/lib/async.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { indexObjects } from "./api.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";

type PageObject = Omit<PageMeta, "lastModified"> & {
  ref: string;
  tags: string[];
  lastModified: string; // indexing it as a string
} & Record<string, any>;

export async function indexPage({ name, tree }: IndexTreeEvent) {
  const pageMeta = await space.getPageMeta(name);
  let pageObj: PageObject = {
    ref: name,
    tags: [], // will be overridden in a bit
    ...pageMeta,
    lastModified: new Date(pageMeta.lastModified).toISOString(),
  };

  const frontmatter: Record<string, any> = await extractFrontmatter(tree);
  const toplevelAttributes = await extractAttributes(tree, false);

  // Push them all into the page object
  pageObj = { ...pageObj, ...frontmatter, ...toplevelAttributes };

  pageObj.tags = ["page", ...pageObj.tags || []];

  // console.log("Extracted page meta data", pageMeta);
  await indexObjects<PageObject>(name, [pageObj]);
}

export async function reindexCommand() {
  await editor.flashNotification("Performing full page reindex...");
  await invokeFunction("reindexSpace");
  await editor.flashNotification("Done with page index!");
}

export async function reindexSpace() {
  console.log("Clearing page index...");
  // Executed this way to not have to embed the search plug code here
  await system.invokeFunction("search.clearIndex");
  await system.invokeFunction("index.clearIndex");
  const pages = await space.listPages();

  // Queue all page names to be indexed
  await mq.batchSend("indexQueue", pages.map((page) => page.name));

  // Now let's wait for the processing to finish
  let queueStats = await mq.getQueueStats("indexQueue");
  while (queueStats.queued > 0 || queueStats.processing > 0) {
    sleep(1000);
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
    await events.dispatchEvent("page:index", {
      name,
      tree: parsed,
    });
  }
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  // console.log("Reindexing", name);
  await events.dispatchEvent("page:index", {
    name,
    tree: await markdown.parseMarkdown(text),
  });
}

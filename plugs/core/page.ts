import type {
  CompleteEvent,
  IndexEvent,
  QueryProviderEvent,
} from "$sb/app_event.ts";
import {
  editor,
  index,
  markdown,
  space,
} from "$sb/silverbullet-syscall/mod.ts";

import { events } from "$sb/plugos-syscall/mod.ts";

import { applyQuery } from "$sb/lib/query.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";
import { backlinkPrefix } from "./page_links.ts";

// Key space:
//   meta: => metaJson

export async function pageQueryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  return applyQuery(query, await space.listPages());
}

export async function deletePage() {
  const pageName = await editor.getCurrentPage();
  if (
    !await editor.confirm(`Are you sure you would like to delete ${pageName}?`)
  ) {
    return;
  }
  console.log("Navigating to index page");
  await editor.navigate("");
  console.log("Deleting page from space");
  await space.deletePage(pageName);
}

export async function copyPage() {
  const oldName = await editor.getCurrentPage();
  const newName = await editor.prompt(`New page title:`, `${oldName} (copy)`);

  if (!newName) {
    return;
  }

  try {
    // This throws an error if the page does not exist, which we expect to be the case
    await space.getPageMeta(newName);
    // So when we get to this point, we error out
    throw new Error(
      `Page ${newName} already exists, cannot rename to existing page.`,
    );
  } catch (e: any) {
    if (e.message === "Not found") {
      // Expected not found error, so we can continue
    } else {
      await editor.flashNotification(e.message, "error");
      throw e;
    }
  }

  const text = await editor.getText();

  console.log("Writing new page to space");
  await space.writePage(newName, text);

  console.log("Navigating to new page");
  await editor.navigate(newName);
}

export async function newPageCommand() {
  const allPages = await space.listPages();
  let pageName = `Untitled`;
  let i = 1;
  while (allPages.find((p) => p.name === pageName)) {
    pageName = `Untitled ${i}`;
    i++;
  }
  await editor.navigate(pageName);
}

export async function reindexCommand() {
  await editor.flashNotification("Reindexing...");
  await reindexSpace();
  await editor.flashNotification("Reindexing done");
}

// Completion
export async function pageComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  const allPages = await space.listPages();
  return {
    from: completeEvent.pos - match[1].length,
    options: allPages.map((pageMeta) => {
      return {
        label: pageMeta.name,
        boost: pageMeta.lastModified,
        type: "page",
      };
    }),
  };
}

export async function reindexSpace() {
  console.log("Clearing page index...");
  await index.clearPageIndex();
  // Executed this way to not have to embed the search plug code here
  await invokeFunction("client", "search.clearIndex");
  console.log("Listing all pages");
  const pages = await space.listPages();
  let counter = 0;
  for (const { name } of pages) {
    counter++;

    console.log(`Indexing page ${counter}/${pages.length}: ${name}`);
    const text = await space.readPage(name);
    const parsed = await markdown.parseMarkdown(text);
    await events.dispatchEvent("page:index", {
      name,
      tree: parsed,
    });
  }
  console.log("Indexing completed!");
}

export async function clearPageIndex(page: string) {
  // console.log("Clearing page index for page", page);
  await index.clearPageIndexForPage(page);
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  // console.log("Reindexing", name);
  await events.dispatchEvent("page:index", {
    name,
    tree: await markdown.parseMarkdown(text),
  });
}

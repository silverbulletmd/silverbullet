import type { CompleteEvent } from "$sb/app_event.ts";
import { editor, space } from "$sb/syscalls.ts";

import { cacheFileListing } from "../federation/federation.ts";
import type { PageMeta } from "../../web/types.ts";

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

// Completion
export async function pageComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  let allPages: PageMeta[] = await space.listPages();
  const prefix = match[1];
  if (prefix.startsWith("!")) {
    // Federation prefix, let's first see if we're matching anything from federation that is locally synced
    const prefixMatches = allPages.filter((pageMeta) =>
      pageMeta.name.startsWith(prefix)
    );
    if (prefixMatches.length === 0) {
      // Ok, nothing synced in via federation, let's see if this URI is complete enough to try to fetch index.json
      if (prefix.includes("/")) {
        // Yep
        const domain = prefix.split("/")[0];
        // Cached listing
        allPages = (await cacheFileListing(domain)).filter((fm) =>
          fm.name.endsWith(".md")
        ).map((fm) => ({
          ...fm,
          name: fm.name.slice(0, -3),
        }));
      }
    }
  }
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

import type { IndexTreeEvent } from "$sb/app_event.ts";
import { space } from "$sb/syscalls.ts";

import type { ObjectValue, PageMeta } from "$sb/types.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { indexObjects } from "./api.ts";

export type PageObject = ObjectValue<
  // The base is PageMeta, but we override lastModified to be a string
  Omit<PageMeta, "lastModified"> & {
    lastModified: string; // indexing it as a string
  } & Record<string, any>
>;

export async function indexPage({ name, tree }: IndexTreeEvent) {
  if (name.startsWith("_")) {
    // Don't index pages starting with _
    return;
  }
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

  // console.log("Page object", pageObj);

  // console.log("Extracted page meta data", pageMeta);
  await indexObjects<PageObject>(name, [pageObj]);
}

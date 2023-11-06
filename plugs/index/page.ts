import type { IndexTreeEvent } from "$sb/app_event.ts";
import { space } from "$sb/syscalls.ts";

import type { PageMeta } from "$sb/types.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { indexObjects } from "./api.ts";

export async function indexPage({ name, tree }: IndexTreeEvent) {
  if (name.startsWith("_")) {
    // Don't index pages starting with _
    return;
  }
  let pageMeta = await space.getPageMeta(name);

  const frontmatter = await extractFrontmatter(tree);
  const toplevelAttributes = await extractAttributes(tree, false);

  // Push them all into the page object
  pageMeta = { ...pageMeta, ...frontmatter, ...toplevelAttributes };

  pageMeta.tags = [...new Set(["page", ...pageMeta.tags || []])];

  // console.log("Page object", pageObj);

  // console.log("Extracted page meta data", pageMeta);
  await indexObjects<PageMeta>(name, [pageMeta]);
}

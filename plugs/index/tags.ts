import { collectNodesOfType } from "$sb/lib/tree.ts";
import type { CompleteEvent, IndexTreeEvent } from "$sb/app_event.ts";
import { removeQueries } from "$sb/lib/query.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { indexObjects } from "./plug_api.ts";
import { queryObjects } from "./api.ts";

export type TagObject = {
  name: string;
  page: string;
  context: string;
};

export async function indexTags({ name, tree }: IndexTreeEvent) {
  removeQueries(tree);
  const allTags = new Set<string>();
  const { tags } = await extractFrontmatter(tree);
  if (Array.isArray(tags)) {
    for (const t of tags) {
      allTags.add(t);
    }
  }
  collectNodesOfType(tree, "Hashtag").forEach((n) => {
    const t = n.children![0].text!.substring(1);
    allTags.add(t);
  });
  await indexObjects<TagObject>(
    name,
    [...allTags].map((t) => ({
      key: [t],
      type: "tag",
      value: { name: t, page: name, context: "page" },
    })),
  );
}

export async function tagComplete(completeEvent: CompleteEvent) {
  const match = /#[^#\s]+$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  const tagPrefix = match[0].substring(1);
  const allTags = await queryObjects<TagObject>("tag", {});
  return {
    from: completeEvent.pos - tagPrefix.length,
    options: allTags.map((tag) => ({
      label: tag.value.name,
      type: "tag",
    })),
  };
}

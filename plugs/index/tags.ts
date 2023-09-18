import type { CompleteEvent, IndexTreeEvent } from "$sb/app_event.ts";
import { removeQueries } from "$sb/lib/query.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { indexObjects, queryObjects } from "./api.ts";

export type TagObject = {
  name: string;
  page: string;
  context: string;
};

export async function indexTags({ name, tree }: IndexTreeEvent) {
  removeQueries(tree);
  let tags: string[] | undefined = (await extractFrontmatter(tree)).tags;
  if (!tags) {
    tags = [];
  }
  await indexObjects<TagObject>(
    name,
    tags.map((t) => ({
      key: [t],
      tags: ["tag"],
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

import type {
  CompleteEvent,
  IndexTreeEvent,
  ObjectValue,
} from "../../plug-api/types.ts";
import { extractFrontmatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { indexObjects, queryObjects } from "./api.ts";
import {
  addParentPointers,
  collectNodesOfType,
  findParentMatching,
} from "@silverbulletmd/silverbullet/lib/tree";
import { extractHashtag, renderHashtag } from "../../plug-api/lib/tags.ts";

export type TagObject = ObjectValue<{
  name: string;
  page: string;
  parent: string;
}>;

export async function indexTags({ name, tree }: IndexTreeEvent) {
  const tags = new Set<string>(); // name:parent
  addParentPointers(tree);
  const pageTags: string[] = (await extractFrontmatter(tree)).tags || [];
  for (const pageTag of pageTags) {
    tags.add(`${pageTag}:page`);
  }
  collectNodesOfType(tree, "Hashtag").forEach((h) => {
    const tagName = extractHashtag(h.children![0].text!);
    // Check if this occurs in the context of a task
    if (findParentMatching(h, (n) => n.type === "Task")) {
      tags.add(`${tagName}:task`);
    } else if (findParentMatching(h, (n) => n.type === "ListItem")) {
      // Or an item
      tags.add(`${tagName}:item`);
    } else if (findParentMatching(h, (n) => n.type === "Paragraph")) {
      // Still indexing this as a page tag
      tags.add(`${tagName}:page`);
    }
  });
  // console.log("Indexing these tags", tags);
  await indexObjects<TagObject>(
    name,
    [...tags].map((tag) => {
      const [tagName, parent] = tag.split(":");
      return {
        ref: tag,
        tag: "tag",
        name: tagName,
        page: name,
        parent,
      };
    }),
  );
}

export async function tagComplete(completeEvent: CompleteEvent) {
  const inLinkMatch = /(?:\[\[|\[.*\]\()([^\]]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (inLinkMatch) {
    return null;
  }

  const match = /#[^#\s\[\]]+\w*$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  // Query all tags with a matching parent
  const allTags: any[] = await queryObjects<TagObject>("tag", {
    select: [{ name: "name" }],
    distinct: true,
  }, 5);

  return {
    from: completeEvent.pos - match[0].length,
    options: allTags.map((tag) => ({
      label: renderHashtag(tag.name),
      type: "tag",
    })),
  };
}

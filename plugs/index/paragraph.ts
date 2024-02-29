import type { IndexTreeEvent } from "../../plug-api/types.ts";
import { indexObjects } from "./api.ts";
import {
  collectNodesOfType,
  findParentMatching,
  renderToText,
  traverseTreeAsync,
} from "../../plug-api/lib/tree.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { ObjectValue } from "../../plug-api/types.ts";
import { updateITags } from "$sb/lib/tags.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";

/** ParagraphObject  An index object for the top level text nodes */
export type ParagraphObject = ObjectValue<
  {
    text: string;
    page: string;
    pos: number;
  } & Record<string, any>
>;

export async function indexParagraphs({ name: page, tree }: IndexTreeEvent) {
  const objects: ParagraphObject[] = [];

  const frontmatter = await extractFrontmatter(tree);

  await traverseTreeAsync(tree, async (p) => {
    if (p.type !== "Paragraph") {
      return false;
    }

    if (findParentMatching(p, (n) => n.type === "ListItem")) {
      // Not looking at paragraphs nested in a list
      return false;
    }

    // So we're looking at indexable a paragraph now
    const tags = new Set<string>();
    collectNodesOfType(p, "Hashtag").forEach((tagNode) => {
      tags.add(tagNode.children![0].text!.substring(1));
      // Hacky way to remove the hashtag
      tagNode.children = [];
    });

    // Extract attributes and remove from tree
    const attrs = await extractAttributes(["paragraph", ...tags], p, true);
    const text = renderToText(p);

    if (!text.trim()) {
      // Empty paragraph, just tags and attributes maybe
      return true;
    }

    const pos = p.from!;
    const paragraph: ParagraphObject = {
      ref: `${page}@${pos}`,
      text,
      tag: "paragraph",
      page,
      pos,
      ...attrs,
    };
    if (tags.size > 0) {
      paragraph.tags = [...tags];
      paragraph.itags = [...tags];
    }

    updateITags(paragraph, frontmatter);
    objects.push(paragraph);

    // stop on every element except document, including paragraphs
    return true;
  });

  // console.log("Paragraph objects", objects);

  await indexObjects<ParagraphObject>(page, objects);
}

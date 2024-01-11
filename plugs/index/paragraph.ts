import type { IndexTreeEvent } from "$sb/app_event.ts";
import { indexObjects } from "./api.ts";
import {
  addParentPointers,
  collectNodesOfType,
  findParentMatching,
  renderToText,
  traverseTreeAsync,
} from "$sb/lib/tree.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { ObjectValue } from "$sb/types.ts";
import a from "https://esm.sh/v135/node_process.js";
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

    const attrs = await extractAttributes(p, true);
    const tags = new Set<string>();
    const text = renderToText(p);

    // So we're looking at indexable a paragraph now
    collectNodesOfType(p, "Hashtag").forEach((tagNode) => {
      tags.add(tagNode.children![0].text!.substring(1));
      // Hacky way to remove the hashtag
      tagNode.children = [];
    });

    const textWithoutTags = renderToText(p);

    if (!textWithoutTags.trim()) {
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

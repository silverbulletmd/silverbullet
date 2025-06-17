import type { IndexTreeEvent } from "../../type/event.ts";
import { indexObjects } from "./api.ts";
import {
  collectNodesOfType,
  findParentMatching,
  renderToText,
  traverseTreeAsync,
} from "../../plug-api/lib/tree.ts";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import { extractFrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { extractHashtag } from "../../plug-api/lib/tags.ts";
import type { ObjectValue } from "../../type/index.ts";

/** ParagraphObject  An index object for the top level text nodes */
export type ParagraphObject = ObjectValue<
  {
    page: string;
    pos: number;
    text: string;
  } & Record<string, any>
>;

export async function indexParagraphs({ name: page, tree }: IndexTreeEvent) {
  const objects: ParagraphObject[] = [];

  const frontmatter = await extractFrontMatter(tree);

  await traverseTreeAsync(tree, async (p) => {
    if (p.type !== "Paragraph") {
      return false;
    }

    if (findParentMatching(p, (n) => n.type === "ListItem")) {
      // Not looking at paragraphs nested in a list
      return false;
    }

    const fullText = renderToText(p);

    // Collect tags and remove from the tree
    const tags = new Set<string>();
    collectNodesOfType(p, "Hashtag").forEach((tagNode) => {
      tags.add(extractHashtag(tagNode.children![0].text!));
      // Hacky way to remove the hashtag
      tagNode.children = [];
    });

    // Extract attributes and remove from tree
    const attrs = await extractAttributes(p);
    const text = renderToText(p);

    if (!text.trim()) {
      // Empty paragraph, just tags and attributes maybe
      return true;
    }

    const pos = p.from!;
    const paragraph: ParagraphObject = {
      tag: "paragraph",
      ref: `${page}@${pos}`,
      text: fullText,
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

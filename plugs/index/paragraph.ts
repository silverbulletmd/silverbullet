import type { IndexTreeEvent } from "../../plug-api/types.ts";
import { indexObjects } from "./api.ts";
import {
  collectNodesOfType,
  findParentMatching,
  renderToText,
  traverseTreeAsync,
} from "../../plug-api/lib/tree.ts";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import type { ObjectValue } from "../../plug-api/types.ts";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import { extractFrontmatter } from "@silverbulletmd/silverbullet/lib/frontmatter";

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

  const frontmatter = await extractFrontmatter(tree);

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

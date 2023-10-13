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
  addParentPointers(tree);
  let paragraphCounter = 0;

  await traverseTreeAsync(tree, async (p) => {
    if (p.type !== "Paragraph") {
      return false;
    }
    paragraphCounter++;

    if (findParentMatching(p, (n) => n.type === "ListItem")) {
      // Not looking at paragraphs nested in a list
      return false;
    }

    // So we're looking at indexable a paragraph now
    const tags = new Set<string>(["paragraph"]);
    if (paragraphCounter > 1) {
      // Only attach hashtags to later paragraphs than the first

      // tag the paragraph with any hashtags inside it
      collectNodesOfType(p, "Hashtag").forEach((tagNode) => {
        tags.add(tagNode.children![0].text!.substring(1));
      });
    }

    const attrs = await extractAttributes(p, false);
    const pos = p.from!;
    objects.push({
      ref: `${page}@${pos}`,
      text: renderToText(p),
      tags: [...tags.values()],
      page,
      pos,
      ...attrs,
    });

    // stop on every element except document, including paragraphs
    return true;
  });

  // console.log("Paragraph objects", objects);

  await indexObjects<ParagraphObject>(page, objects);
}

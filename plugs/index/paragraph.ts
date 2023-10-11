import type { IndexTreeEvent } from "$sb/app_event.ts";
import { indexObjects } from "./api.ts";
import { renderToText, traverseTree, traverseTreeAsync } from "$sb/lib/tree.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";

/** ParagraphObject  An index object for the top level text nodes */
export type ParagraphObject = {
  ref: string;
  tags: string[];
  text: string;
  page: string;
  pos: number;
} & Record<string, any>;

export async function indexParagraphs({ name: page, tree }: IndexTreeEvent) {
  const objects: ParagraphObject[] = [];

  await traverseTreeAsync(tree, async (p) => {
    // only search directly under document
    //  Paragraph nodes also appear under block elements
    if (p.type == "Document") return false; // continue traversal if p is Document
    if (p.type != "Paragraph") return true;

    const tags = new Set<string>(["paragraph"]);
    // tag the paragraph with any hashtags inside it
    traverseTree(p, (e) => {
      if (e.type == "Hashtag") {
        tags.add(e.children![0].text!.substring(1));
        return true;
      }

      return false;
    });

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

  await indexObjects<ParagraphObject>(page, objects);
}

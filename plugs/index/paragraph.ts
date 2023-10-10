import type { IndexTreeEvent } from "$sb/app_event.ts";
import { removeQueries } from "$sb/lib/query.ts";
import { indexObjects } from "./api.ts";
import {
  addParentPointers,
  renderToText,
  traverseTree,
  traverseTreeAsync,
} from "$sb/lib/tree.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";

export type ParagraphObject = {
  ref: string;
  tags: string[];
  text: string;
  // TODO: maybe it would be useful to have a list of the the headings above the paragraph
  page: string;
  startPos: number;
  endPos: number;
} & Record<string, any>;

export async function indexParagraphs({ name: page, tree }: IndexTreeEvent) {
  const objects: ParagraphObject[] = [];
  await traverseTreeAsync(tree, async (p) => {
    // only search directly under document
    if (p.type == "Document") return false;
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
    objects.push({
      ref: `${page}:${p.from}:${p.to}`,
      text: renderToText(p),
      tags: [...tags.values()],
      page,
      startPos: p.from!,
      endPos: p.to!,
      ...attrs,
    });

    // stop on every element except document (see above)
    return true;
  });

  await indexObjects<ParagraphObject>(page, objects);
}

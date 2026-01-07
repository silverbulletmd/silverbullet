import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { indexObjects } from "./api.ts";
import {
  findParentMatching,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { cleanTags, collectTags, updateITags } from "./tags.ts";
import { extractFrontMatter } from "./frontmatter.ts";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { system } from "@silverbulletmd/silverbullet/syscalls";
import { cleanAttributes, collectAttributes } from "./attribute.ts";

/** ParagraphObject  An index object for the top level text nodes */
export type ParagraphObject = ObjectValue<
  {
    page: string;
    pos: number;
    text: string;
  } & Record<string, any>
>;

export async function indexParagraphs({ name: page, tree }: IndexTreeEvent) {
  const shouldIndexAll = await system.getConfig(
    "index.paragraph.all",
    true,
  );

  const objects: ParagraphObject[] = [];

  const frontmatter = extractFrontMatter(tree);

  traverseTree(tree, (p) => {
    if (p.type !== "Paragraph") {
      return false;
    }

    if (findParentMatching(p, (n) => n.type === "ListItem")) {
      // Not looking at paragraphs nested in a list
      return false;
    }

    const fullText = renderToText(p);

    // Collect tags and remove from the tree
    const tags = collectTags(p);

    if (tags.length === 0 && !shouldIndexAll) {
      // Don't index paragraphs without a hashtag
      return false;
    }

    // Extract attributes
    const attrs = collectAttributes(p);

    // Clean tree
    cleanTags(p);
    cleanAttributes(p);
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
    if (tags.length > 0) {
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

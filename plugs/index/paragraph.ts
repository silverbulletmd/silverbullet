import {
  findParentMatching,
  type ParseTree,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { cleanTags, collectTags, updateITags } from "./tags.ts";
import type { FrontMatter } from "./frontmatter.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { system } from "@silverbulletmd/silverbullet/syscalls";
import { cleanAttributes, collectAttributes } from "./attribute.ts";
import { deepClone } from "@silverbulletmd/silverbullet/lib/json";

/** ParagraphObject  An index object for the top level text nodes */
export type ParagraphObject = ObjectValue<
  {
    page: string;
    pos: number;
    text: string;
  } & Record<string, any>
>;

export async function indexParagraphs(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const shouldIndexAll = await system.getConfig(
    "index.paragraph.all",
    false,
  );

  const objects: ParagraphObject[] = [];

  traverseTree(tree, (p) => {
    if (p.type !== "Paragraph") {
      return false;
    }

    if (findParentMatching(p, (n) => n.type === "ListItem")) {
      // Not looking at paragraphs nested in a list
      return true;
    }

    const fullText = renderToText(p);

    // Collect tags
    const tags = collectTags(p);

    if (tags.length === 0 && !shouldIndexAll) {
      // Don't index paragraphs without a hashtag
      return true;
    }

    // Extract attributes
    const attrs = collectAttributes(p);

    // Clean tree, just to check if it's effectively empty or not
    const cleanP = deepClone(p, ["parent"]);
    cleanTags(cleanP);
    cleanAttributes(cleanP);
    const text = renderToText(cleanP);

    if (!text.trim()) {
      // Empty paragraph, just tags and attributes maybe
      return true;
    }

    const pos = p.from!;
    const paragraph: ParagraphObject = {
      tag: "paragraph",
      ref: `${pageMeta.name}@${pos}`,
      text: fullText,
      page: pageMeta.name,
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

  return objects;
}

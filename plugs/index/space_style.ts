import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { FrontMatter } from "./frontmatter.ts";

export type StyleObject = ObjectValue<{
  style: string;
  priority?: number;
}>;

export function indexSpaceStyle(
  pageMeta: PageMeta,
  _frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const allStyles: StyleObject[] = [];

  // Also collect CSS from custom styles in config
  collectNodesOfType(tree, "FencedCode").map((t) => {
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }

    const fenceType = codeInfoNode.children![0].text!;
    if (fenceType !== "space-style") {
      return;
    }

    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;

    // Parse out /* priority: */
    const priority = codeText.match(/\/\*+\s*priority:\s*(-?\d+)/)?.[1];

    allStyles.push({
      ref: `${pageMeta.name}@${t.from!}`,
      tag: "space-style",
      style: codeText,
      priority: priority !== undefined ? +priority : undefined,
    });
  });

  return Promise.resolve(allStyles);
}

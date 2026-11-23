import {
  findToolBlocks,
  isLibraryPage,
} from "@silverbulletmd/silverbullet/lib/library_pages";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
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
): Promise<StyleObject[]> {
  if (!isLibraryPage(pageMeta.name)) {
    return Promise.resolve([]);
  }
  return Promise.resolve(
    findToolBlocks(tree)
      .filter((b) => b.fence === "space-style")
      .map((b) => ({
        ref: `${pageMeta.name}@${b.from}`,
        tag: "space-style",
        range: [b.codeFrom, b.codeTo],
        style: b.code,
        ...(b.priority !== undefined ? { priority: b.priority } : {}),
      })),
  );
}

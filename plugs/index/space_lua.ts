import {
  findToolBlocks,
  isToolPage,
} from "@silverbulletmd/silverbullet/lib/tool_pages";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { FrontMatter } from "./frontmatter.ts";

export type SpaceLuaObject = ObjectValue<{
  script: string;
  priority?: number;
}>;

export function indexSpaceLua(
  pageMeta: PageMeta,
  _frontmatter: FrontMatter,
  tree: ParseTree,
): Promise<SpaceLuaObject[]> {
  if (!isToolPage(pageMeta.name)) {
    return Promise.resolve([]);
  }
  return Promise.resolve(
    findToolBlocks(tree)
      .filter((b) => b.fence === "space-lua")
      .map((b) => ({
        ref: `${pageMeta.name}@${b.from}`,
        tag: "space-lua",
        range: [b.codeFrom, b.codeTo],
        script: b.code,
        ...(b.priority !== undefined ? { priority: b.priority } : {}),
      })),
  );
}

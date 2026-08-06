import {
  collectNodesOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { FrontMatter } from "./frontmatter.ts";
import {
  type CommentMessage,
  parseCommentBlock,
} from "../../plug-api/lib/comments.ts";

export type CommentObject = ObjectValue<
  {
    page: string;
    range: [number, number];
    quote?: string;
    thread: CommentMessage[];
    addressees: string[];
    waitingOn?: string;
    lastDate?: string;
    pageLastModified: string;
  } & Record<string, any>
>;

export function indexComments(
  pageMeta: PageMeta,
  _frontmatter: FrontMatter,
  tree: ParseTree,
): Promise<CommentObject[]> {
  const objects: CommentObject[] = [];
  for (const node of collectNodesOfType(tree, "CommentBlock")) {
    const parsed = parseCommentBlock(renderToText(node));
    if (!parsed) {
      continue;
    }
    objects.push({
      tag: "comment",
      ref: `${pageMeta.name}@${node.from!}`,
      page: pageMeta.name,
      range: [node.from!, node.to!],
      ...parsed,
      pageLastModified: pageMeta.lastModified,
    });
  }
  return Promise.resolve(objects);
}

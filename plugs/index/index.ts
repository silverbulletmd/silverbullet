import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter, type FrontMatter } from "./frontmatter.ts";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { space } from "@silverbulletmd/silverbullet/syscalls";
import { indexObjects } from "./api.ts";
import { indexPage as pageIndexPage } from "./page.ts";
import { indexData } from "./data.ts";
import { indexItems } from "./item.ts";
import { indexHeaders } from "./header.ts";
import { indexParagraphs } from "./paragraph.ts";
import { indexLinks } from "./page_links.ts";
import { indexTables } from "./table.ts";
import { indexSpaceLua } from "./space_lua.ts";
import { indexSpaceStyle } from "./space_style.ts";
import { indexTags } from "./tags.ts";

export type IndexerFunction = (
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
  text: string,
) => Promise<ObjectValue<any>[]>;

const allIndexers: IndexerFunction[] = [
  pageIndexPage,
  indexData,
  indexItems,
  indexHeaders,
  indexParagraphs,
  indexLinks,
  indexTables,
  indexSpaceLua,
  indexSpaceStyle,
  indexTags,
];

export async function indexPage({ name, tree, text }: IndexTreeEvent) {
  const pageMeta = await space.getPageMeta(name);
  const frontmatter = extractFrontMatter(tree);

  // console.log("Now going to index page", name);

  // Index the page
  const index = await Promise.all(allIndexers.map((indexer) => {
    return indexer(pageMeta, frontmatter, tree, text);
  }));

  // console.log("Found these objects", index.flat());

  await indexObjects<any>(name, index.flat());
}

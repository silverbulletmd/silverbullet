import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import {
  extractFrontMatter,
  type FrontMatter,
} from "@silverbulletmd/silverbullet/lib/frontmatter";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { space } from "@silverbulletmd/silverbullet/syscalls";
import { indexObjects } from "./api.ts";
import { indexPage as pageIndexPage } from "./page.ts";
import { indexData } from "./data.ts";
import { indexItems } from "./item.ts";

export type IndexerFunction = (
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) => Promise<ObjectValue<any>[]>;

const allIndexers: IndexerFunction[] = [pageIndexPage, indexData, indexItems];

export async function indexPage({ name, tree }: IndexTreeEvent) {
  const pageMeta = await space.getPageMeta(name);
  const frontmatter = await extractFrontMatter(tree);

  console.log("Now going to index page", name);

  // Index the page
  const index = await Promise.all(allIndexers.map((indexer) => {
    return indexer(pageMeta, frontmatter, tree);
  }));

  console.log("Found these objects", index.flat());

  await indexObjects<any>(name, index.flat());
}

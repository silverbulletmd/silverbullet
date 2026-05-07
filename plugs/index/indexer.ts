import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter, type FrontMatter } from "./frontmatter.ts";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { indexPage as pageIndexPage } from "./page.ts";
import { indexData } from "./data.ts";
import { indexItems } from "./item.ts";
import { indexHeaders } from "./header.ts";
import { indexParagraphs } from "./paragraph.ts";
import { indexLinks } from "./link.ts";
import { indexTables } from "./table.ts";
import { indexSpaceLua } from "./space_lua.ts";
import { indexSpaceStyle } from "./space_style.ts";
import { indexTags } from "./tags.ts";
import { index, markdown } from "@silverbulletmd/silverbullet/syscalls";
import { isValidAnchorName } from "./anchor.ts";

export type IndexerFunction = (
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
  text: string,
) => Promise<ObjectValue<any>[]>;

// Object tags that never carry a `$name` anchor — they emit their own
// refs (page name, tag name, etc.) that could coincidentally pass
// `isValidAnchorName` and produce spurious anchor records.
const NON_ANCHORABLE_TAGS = new Set([
  "anchor",
  "page",
  "tag",
  "aspiring-page",
  "space-lua",
  "space-style",
]);

/**
 * Post-processes the combined object list and appends one dedicated
 * `anchor`-tagged record for each anchored host. A host is "anchored"
 * iff its `ref` field is a valid anchor name AND its tag is anchorable
 * (paragraph, item, task, header, or any user-defined data-block tag).
 * The `Page@pos` and `Page#header` ref shapes of un-anchored objects
 * never pass `isValidAnchorName`, but page/tag refs can — hence the
 * deny-list above.
 */
function appendAnchorRecords(objects: ObjectValue<any>[]): ObjectValue<any>[] {
  const anchorRecords: ObjectValue<any>[] = [];
  for (const o of objects) {
    if (
      !NON_ANCHORABLE_TAGS.has(o.tag) &&
      typeof o.ref === "string" &&
      typeof o.page === "string" &&
      isValidAnchorName(o.ref)
    ) {
      anchorRecords.push({
        tag: "anchor",
        ref: o.ref,
        page: o.page,
        hostTag: o.tag,
      });
    }
  }
  return [...objects, ...anchorRecords];
}

export const allIndexers: IndexerFunction[] = [
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

/**
 * Pass-1 indexers run during the bootstrap phase, before Lua scripts are
 * evaluated and custom styles applied. They produce a usable Lua + style
 * runtime: the page object itself (so `index.tag 'page'` queries work),
 * tags (frontmatter / hashtag), and the lua/style fence content.
 */
export const pass1Indexers: IndexerFunction[] = [
  pageIndexPage,
  indexTags,
  indexSpaceLua,
  indexSpaceStyle,
];

/**
 * Pass-2 indexers run after the UI is interactive. They cover the bulk of
 * indexable content — links, headers, paragraphs, items, tables, data —
 * and are the same set as `allIndexers` so a Pass-2 reindex produces the
 * full, queryable index.
 */
export const pass2Indexers: IndexerFunction[] = allIndexers;

/**
 * Ad-hoc index a piece of markdown text
 * @return a list of indexed objects
 */
export async function indexMarkdown(
  text: string,
  pageMeta: PageMeta = {
    ref: "",
    tag: "",
    name: "",
    perm: "ro",
    lastModified: "",
    created: "",
  },
): Promise<ObjectValue<any>> {
  const tree = await markdown.parseMarkdown(text);
  const frontmatter = extractFrontMatter(tree);
  const indexResults = await Promise.all(
    allIndexers
      .filter((indexer) => indexer !== pageIndexPage)
      .map((indexer) => {
        return indexer(pageMeta, frontmatter, tree, text);
      }),
  );
  return appendAnchorRecords(indexResults.flat());
}

export async function indexPage({ name, tree, meta, text }: IndexTreeEvent) {
  try {
    const frontmatter = extractFrontMatter(tree);
    const indexResults = await Promise.all(
      allIndexers.map((indexer) => {
        return indexer(meta, frontmatter, tree, text);
      }),
    );
    await index.indexObjects<any>(name, appendAnchorRecords(indexResults.flat()));
  } catch (e: any) {
    console.error(
      `[index] Failed to index page "${name}": ${e?.message ?? e}`,
    );
  }
}

export async function indexPagePass1({
  name,
  tree,
  meta,
  text,
}: IndexTreeEvent) {
  try {
    const frontmatter = extractFrontMatter(tree);
    const indexResults = await Promise.all(
      pass1Indexers.map((indexer) => {
        return indexer(meta, frontmatter, tree, text);
      }),
    );
    await index.indexObjects<any>(name, indexResults.flat());
  } catch (e: any) {
    console.error(
      `[index] Failed to index page "${name}" (Pass-1): ${e?.message ?? e}`,
    );
  }
}

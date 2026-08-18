import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter, type FrontMatter } from "./frontmatter.ts";
import {
  collectNodesOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { indexPage as pageIndexPage } from "./page.ts";
import { indexData } from "./data.ts";
import { indexItems } from "./item.ts";
import { indexHeaders } from "./header.ts";
import { indexParagraphs } from "./paragraph.ts";
import { indexRelations } from "./relation.ts";
import { indexTables } from "./table.ts";
import { indexSpaceLua } from "./space_lua.ts";
import { indexSpaceStyle } from "./space_style.ts";
import { indexTags } from "./tags.ts";
import { index, markdown } from "@silverbulletmd/silverbullet/syscalls";
import { isValidAnchorName } from "./anchor.ts";
import { buildLineIndex, extractSnippet, type LineIndex } from "./snippet.ts";

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

// Scripts and stylesheets are the one thing a comment must genuinely disable:
// commenting a block out is how people turn it off.
const INERT_IN_COMMENT_TAGS = new Set(["space-lua", "space-style"]);

/** `inComment` is reserved in position_attributes.ts, but no indexer consults that reservation, so a user-written one is dropped here. */
function markCommentedObjects(
  objects: ObjectValue<any>[],
  tree: ParseTree,
): ObjectValue<any>[] {
  const ranges = collectNodesOfType(tree, "CommentBlock").map(
    (n) => [n.from!, n.to!] as [number, number],
  );
  const result: ObjectValue<any>[] = [];
  for (const o of objects) {
    const from = o.range?.[0];
    const inside =
      typeof from === "number" &&
      ranges.some(([rFrom, rTo]) => from >= rFrom && from < rTo);
    if (!inside) {
      if ("inComment" in o) {
        const { inComment: _drop, ...rest } = o;
        result.push(rest as ObjectValue<any>);
      } else {
        result.push(o);
      }
    } else if (!INERT_IN_COMMENT_TAGS.has(o.tag)) {
      result.push({ ...o, inComment: true });
    }
  }
  return result;
}

/**
 * Post-processes the combined object list and appends one dedicated
 * `anchor`-tagged record for each anchored host. A host is "anchored"
 * iff its `ref` field is a valid anchor name AND its tag is anchorable
 * (paragraph, item, task, header, or any user-defined data-block tag).
 * The `Page@pos` and `Page#header` ref shapes of un-anchored objects
 * never pass `isValidAnchorName`, but page/tag refs can — hence the
 * deny-list above.
 */
function appendAnchorRecords(
  objects: ObjectValue<any>[],
  pageMeta: PageMeta,
  text: string,
): ObjectValue<any>[] {
  const anchorRecords: ObjectValue<any>[] = [];
  // Built at most once per page, and only if the page has any anchors at all.
  let lineIndex: LineIndex | undefined;
  for (const o of objects) {
    if (
      !NON_ANCHORABLE_TAGS.has(o.tag) &&
      typeof o.ref === "string" &&
      typeof o.page === "string" &&
      isValidAnchorName(o.ref)
    ) {
      const record: ObjectValue<any> = {
        tag: "anchor",
        ref: o.ref,
        page: o.page,
        hostTag: o.tag,
        pageLastModified: pageMeta.lastModified,
        ...(o.inComment ? { inComment: true } : {}),
      };
      // Reuse the same snippet machinery relation.ts uses, so an anchored
      // list item pulls in its indented children and nested tasks get a
      // page ref, rather than us inventing a second truncation scheme.
      const from = o.range?.[0];
      if (typeof from === "number") {
        lineIndex ??= buildLineIndex(text);
        record.snippet = extractSnippet(pageMeta.name, lineIndex, from);
      }
      anchorRecords.push(record);
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
  indexRelations,
  indexTables,
  indexSpaceLua,
  indexSpaceStyle,
  indexTags,
];

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
      .map((indexer) => indexer(pageMeta, frontmatter, tree, text)),
  );
  return appendAnchorRecords(
    markCommentedObjects(indexResults.flat(), tree),
    pageMeta,
    text,
  );
}

export async function indexPage({ name, tree, meta, text }: IndexTreeEvent) {
  const frontmatter = extractFrontMatter(tree);
  const indexResults = await Promise.all(
    allIndexers.map((indexer) => indexer(meta, frontmatter, tree, text)),
  );
  await index.indexObjects<any>(
    name,
    appendAnchorRecords(
      markCommentedObjects(indexResults.flat(), tree),
      meta,
      text,
    ),
  );
}

import {
  collectNodesOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { index, markdown } from "@silverbulletmd/silverbullet/syscalls";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { isValidAnchorName } from "./anchor.ts";
import { indexData } from "./data.ts";
import { extractFrontMatter, type FrontMatter } from "./frontmatter.ts";
import { indexHeaders } from "./header.ts";
import { indexItems } from "./item.ts";
import { indexPage as pageIndexPage } from "./page.ts";
import { indexParagraphs } from "./paragraph.ts";
import { RECIPIENT_PREFIX } from "./recipient.ts";
import { indexRelations } from "./relation.ts";
import { buildLineIndex, extractSnippet, type LineIndex } from "./snippet.ts";
import { indexSpaceLua } from "./space_lua.ts";
import { indexSpaceStyle } from "./space_style.ts";
import { indexTables } from "./table.ts";
import { indexTags } from "./tags.ts";

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

function stampRecipients(
  objects: ObjectValue<any>[],
  frontmatter: FrontMatter,
): ObjectValue<any>[] {
  const mentions = objects.filter(
    (o) => o.tag === "relation" && o.kind === "at-mention",
  );
  const fmList: string[] = Array.isArray(frontmatter.recipients)
    ? frontmatter.recipients
    : [];
  const pageTargets = new Set<string>();
  for (const raw of fmList) {
    const wikiMatch = /^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/.exec(String(raw).trim());
    // A wiki link names a page directly, so it stamps that page; a nickname
    // stamps its recipient: identifier, like an inline @mention would.
    if (wikiMatch) {
      pageTargets.add(wikiMatch[1]);
      continue;
    }
    pageTargets.add(RECIPIENT_PREFIX + String(raw).trim().toLowerCase());
  }
  const byHost = new Map<string, Set<string>>();
  for (const m of mentions) {
    if (m.fromTag === "page") {
      pageTargets.add(m.to);
    } else {
      const key = `${m.fromTag}\0${m.from}`;
      let set = byHost.get(key);
      if (!set) {
        set = new Set();
        byHost.set(key, set);
      }
      set.add(m.to);
    }
  }
  if (pageTargets.size === 0 && byHost.size === 0) {
    return objects;
  }
  return objects.map((o) => {
    const targets =
      o.tag === "page" ? pageTargets : byHost.get(`${o.tag}\0${o.ref}`);
    if (!targets || targets.size === 0) {
      return o;
    }
    return { ...o, recipients: [...targets].sort() };
  });
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
  return stampRecipients(
    appendAnchorRecords(
      markCommentedObjects(indexResults.flat(), tree),
      pageMeta,
      text,
    ),
    frontmatter,
  );
}

export async function indexPage({ name, tree, meta, text }: IndexTreeEvent) {
  const frontmatter = extractFrontMatter(tree);
  const indexResults = await Promise.all(
    allIndexers.map((indexer) => indexer(meta, frontmatter, tree, text)),
  );
  await index.indexObjects<any>(
    name,
    stampRecipients(
      appendAnchorRecords(
        markCommentedObjects(indexResults.flat(), tree),
        meta,
        text,
      ),
      frontmatter,
    ),
  );
}

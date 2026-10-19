import { extractHashtag } from "@silverbulletmd/silverbullet/lib/tags";
import {
  collectNodesOfType,
  findParentMatching,
  type ParseTree,
  replaceNodesMatching,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { index, lua } from "@silverbulletmd/silverbullet/syscalls";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { tagRegex } from "../../client/markdown_parser/constants.ts";
import { frontmatterValuePrefix } from "./complete.ts";
import type { FrontMatter } from "./frontmatter.ts";

export type TagObject = ObjectValue<{
  name: string;
  page: string;
  parent: string;
}>;

/**
 * A node's own range when it sits inside a comment, undefined otherwise. Only
 * an object carrying a range can be flagged as commented (see indexer.ts), and
 * a tag has just one record per page, so it counts as commented out only when
 * every occurrence of it is.
 */
export function commentedRange(node: ParseTree): [number, number] | undefined {
  return findParentMatching(node, (n) => n.type === "CommentBlock")
    ? [node.from!, node.to!]
    : undefined;
}

/**
 * The root tag of the object a hashtag attaches to. A paragraph holding nothing
 * but hashtags tags the page; any other paragraph is tagged itself.
 */
function hashtagParent(h: ParseTree): string | undefined {
  // Outermost structure first: an item's text is itself a Paragraph node
  const within = (match: (type: string) => boolean) =>
    findParentMatching(h, (n) => match(n.type!));
  if (within((t) => t === "Task")) return "task";
  if (within((t) => t === "ListItem")) return "item";
  if (within((t) => t === "Table")) return "table";
  if (within((t) => t.startsWith("ATXHeading"))) return "header";
  const paragraph = within((t) => t === "Paragraph");
  if (!paragraph) return undefined;
  return isTagOnlyParagraph(paragraph) ? "page" : "paragraph";
}

function isTagOnlyParagraph(p: ParseTree): boolean {
  return p.children!.every(
    (c) => c.type === "Hashtag" || (c.text !== undefined && !c.text.trim()),
  );
}

/**
 * Indexes a tag record per root tag the tag is used with; tags declared by
 * fenced data blocks are handled in data.ts
 */
export function indexTags(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  // name:parent -> the range of a commented occurrence, undefined once the tag
  // has been seen outside a comment
  const tags = new Map<string, [number, number] | undefined>();
  const pageTags: string[] = frontmatter.tags || [];
  for (const pageTag of pageTags) {
    tags.set(`${pageTag}:page`, undefined);
  }
  collectNodesOfType(tree, "Hashtag").forEach((h) => {
    const tagName = extractHashtag(h.children![0].text!);
    const parent = hashtagParent(h);
    if (!parent) {
      return;
    }
    const key = `${tagName}:${parent}`;
    const range = commentedRange(h);
    if (!range) {
      tags.set(key, undefined);
    } else if (!tags.has(key)) {
      tags.set(key, range);
    }
  });
  return Promise.resolve(
    [...tags].map(([tag, range]) => {
      const [tagName, parent] = tag.split(":");
      return {
        ref: tag,
        tag: "tag",
        name: tagName,
        page: pageMeta.name,
        parent,
        ...(range ? { range } : {}),
      };
    }),
  );
}

/** Every tag name that occurs outside a comment somewhere in the space. The
 * "tag" collection also holds anything tagged #tag (e.g. a paragraph), so
 * keep to genuine tag records. */
async function liveTagsQuery() {
  return {
    distinct: true,
    select: { type: "Variable", name: "name", ctx: {} as any } as const,
    where: await lua.parseExpression('_.tag == "tag" and not _.inComment'),
  };
}

export async function tagComplete(completeEvent: CompleteEvent) {
  const inLinkMatch = /(?:\[\[|\[.*\]\()([^\]]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (inLinkMatch) {
    return null;
  }

  const match = /#[^#\s[\]]*$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  // Don't trigger on markdown headers (# Heading, ## Heading, etc.)
  if (match.index === 0 && /^#{1,6}(\s|$)/.test(completeEvent.linePrefix)) {
    return null;
  }
  // Don't trigger when the # is preceded by another # (e.g. ##, ###) —
  // that's a header prefix being typed, not a tag.
  if (match.index > 0 && completeEvent.linePrefix[match.index - 1] === "#") {
    return null;
  }

  // Query all tags with a matching parent
  const allTags: string[] = await index.queryLuaObjects<string>(
    "tag",
    await liveTagsQuery(),
  );

  return {
    from: completeEvent.pos - match[0].length,
    options: allTags.map((tag) => ({
      label: renderHashtag(tag),
      type: "tag",
    })),
  };
}

export async function frontmatterTagComplete(completeEvent: CompleteEvent) {
  const prefix = frontmatterValuePrefix(completeEvent, "tags");
  if (prefix === null) {
    return null;
  }

  const allTags: string[] = await index.queryLuaObjects<string>(
    "tag",
    await liveTagsQuery(),
  );

  return {
    from: completeEvent.pos - prefix.length,
    options: allTags.map((tag) => ({
      label: tag,
      type: "tag",
    })),
  };
}

/**
 * A YAML `tags` value as a list of tag names: accepts a list, or a string of
 * "tag1, tag2", "tag1 tag2" or "#tag1 #tag2"
 */
export function normalizeTagList(value: unknown): string[] {
  const raw =
    typeof value === "string"
      ? value.split(/,\s*|\s+/)
      : Array.isArray(value)
        ? value
        : [];
  return [
    ...new Set(
      raw.map((t) => String(t).replace(/^#/, "")).filter((t) => t !== ""),
    ),
  ];
}

export function updateITags<T>(obj: ObjectValue<T>, frontmatter: FrontMatter) {
  const itags = new Set<string>([obj.tag, ...(frontmatter.tags || [])]);
  for (const tag of obj.tags || []) {
    itags.add(tag);
  }
  for (const tag of obj.itags || []) {
    itags.add(tag);
  }
  obj.itags = [...itags];
}

/** Get markup for a hashtag name with # prefix and angle brackets if necessary */
export function renderHashtag(name: string): string {
  // detect with the same regex as the parser
  const simple: string = `#${name}`;
  const match = simple.match(tagRegex);
  if (!match || match[0].length !== simple.length) {
    return `#<${name}>`;
  } else return simple;
}

/**
 * Cleans hashtags from a tree as a side effect
 * @param n
 * @return found hashtags
 */
export function collectTags(n: ParseTree): string[] {
  const tags = new Set<string>();
  traverseTree(
    n,
    (n) => {
      if (n.type === "Hashtag") {
        tags.add(extractHashtag(n.children![0].text!));
        return true;
      } else if (n.type === "OrderedList" || n.type === "BulletList") {
        // Don't traverse into sub-lists
        return true;
      }
      return false;
    },
    true,
  );
  return [...tags];
}

/**
 * Cleans hashtags from a tree as a side effect
 * @param n
 */
export function cleanTags(n: ParseTree) {
  return replaceNodesMatching(n, (n) => {
    if (n.type === "Hashtag") {
      return null;
    }
    return;
  });
}

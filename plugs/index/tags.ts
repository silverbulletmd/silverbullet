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
 * Handles indexing of page, item and task level tags, data tags are handled in data.ts
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
    let key: string | undefined;
    // Check if this occurs in the context of a task
    if (findParentMatching(h, (n) => n.type === "Task")) {
      key = `${tagName}:task`;
    } else if (findParentMatching(h, (n) => n.type === "ListItem")) {
      // Or an item
      key = `${tagName}:item`;
    } else if (findParentMatching(h, (n) => n.type === "Paragraph")) {
      // Still indexing this as a page tag
      key = `${tagName}:page`;
    }
    if (!key) {
      return;
    }
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

/** Every tag name that occurs outside a comment somewhere in the space. */
async function liveTagsQuery() {
  return {
    distinct: true,
    select: { type: "Variable", name: "name", ctx: {} as any } as const,
    where: await lua.parseExpression("not _.inComment"),
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

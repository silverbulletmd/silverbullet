import type { FrontMatter } from "./frontmatter.ts";
import {
  collectNodesOfType,
  findParentMatching,
  type ParseTree,
  replaceNodesMatching,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import { tagRegex } from "../../client/markdown_parser/constants.ts";
import { extractHashtag } from "@silverbulletmd/silverbullet/lib/tags";
import { index } from "@silverbulletmd/silverbullet/syscalls";

export type TagObject = ObjectValue<{
  name: string;
  page: string;
  parent: string;
}>;

/**
 * Handles indexing of page, item and task level tags, data tags are handled in data.ts
 */
export function indexTags(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const tags = new Set<string>(); // name:parent
  const pageTags: string[] = frontmatter.tags || [];
  for (const pageTag of pageTags) {
    tags.add(`${pageTag}:page`);
  }
  collectNodesOfType(tree, "Hashtag").forEach((h) => {
    const tagName = extractHashtag(h.children![0].text!);
    // Check if this occurs in the context of a task
    if (findParentMatching(h, (n) => n.type === "Task")) {
      tags.add(`${tagName}:task`);
    } else if (findParentMatching(h, (n) => n.type === "ListItem")) {
      // Or an item
      tags.add(`${tagName}:item`);
    } else if (findParentMatching(h, (n) => n.type === "Paragraph")) {
      // Still indexing this as a page tag
      tags.add(`${tagName}:page`);
    }
  });
  return Promise.resolve(
    [...tags].map((tag) => {
      const [tagName, parent] = tag.split(":");
      return {
        ref: tag,
        tag: "tag",
        name: tagName,
        page: pageMeta.name,
        parent,
      };
    }),
  );
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

  // Query all tags with a matching parent
  const allTags: string[] = await index.queryLuaObjects<string>("tag", {
    distinct: true,
    select: { type: "Variable", name: "name", ctx: {} as any },
  });

  return {
    from: completeEvent.pos - match[0].length,
    options: allTags.map((tag) => ({
      label: renderHashtag(tag),
      type: "tag",
    })),
  };
}

export async function frontmatterTagComplete(completeEvent: CompleteEvent) {
  // Only trigger inside frontmatter
  const frontmatterNode = completeEvent.parentNodes.find((n) =>
    n.startsWith("FrontMatter:")
  );
  if (!frontmatterNode) {
    return null;
  }

  const fmContent = frontmatterNode.substring("FrontMatter:".length);

  // Determine if the cursor line is within a tags section
  // Pattern 1: tags: value or tags: [v1, v2, partial (comma or space separated)
  const tagsLineMatch = /tags:\s+\[?(?:.*[,\s]\s*)?([^\s!@$%^&*(),.?":{}|<>\\[\]]*)$/.exec(
    completeEvent.linePrefix,
  );

  let prefix = "";
  if (tagsLineMatch) {
    prefix = tagsLineMatch[1];
  } else {
    // Pattern 2: list item under a tags: key (e.g. "  - partial")
    const listItemMatch = /^\s+-\s+([^\s!@$%^&*(),.?":{}|<>\\[\]]*)$/.exec(completeEvent.linePrefix);
    if (!listItemMatch) {
      return null;
    }

    // Check if this list item is under the tags: key using cheap YAML parsing
    const lines = fmContent.split("\n");
    const cursorLineText = completeEvent.linePrefix;
    let inTagsSection = false;
    let foundCursorInTags = false;

    for (const line of lines) {
      const kvMatch = /^\s*(\w+):/.exec(line);
      if (kvMatch) {
        inTagsSection = kvMatch[1] === "tags";
      }
      if (inTagsSection && line.trimEnd() === cursorLineText.trimEnd()) {
        foundCursorInTags = true;
        break;
      }
    }

    if (!foundCursorInTags) {
      return null;
    }
    prefix = listItemMatch[1];
  }

  const allTags: string[] = await index.queryLuaObjects<string>("tag", {
    distinct: true,
    select: { type: "Variable", name: "name", ctx: {} as any },
  });

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
  traverseTree(n, (n) => {
    if (n.type === "Hashtag") {
      tags.add(extractHashtag(n.children![0].text!));
      return true;
    } else if (n.type === "OrderedList" || n.type === "BulletList") {
      // Don't traverse into sub-lists
      return true;
    }
    return false;
  });
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

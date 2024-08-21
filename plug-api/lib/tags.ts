import type { FrontMatter } from "./frontmatter.ts";
import type { ObjectValue } from "../types.ts";
import {
  type ParseTree,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";

export function updateITags<T>(obj: ObjectValue<T>, frontmatter: FrontMatter) {
  const itags = [obj.tag, ...frontmatter.tags || []];
  if (obj.tags) {
    for (const tag of obj.tags) {
      if (!itags.includes(tag)) {
        itags.push(tag);
      }
    }
  }
  obj.itags = itags;
}

/**
 * Extracts a set of hashtags from a tree
 * @param n the tree to extract from
 * @returns
 */
export function extractHashTags(n: ParseTree): string[] {
  const tags = new Set<string>();
  traverseTree(n, (n) => {
    if (n.type === "Hashtag") {
      tags.add(n.children![0].text!.substring(1));
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
export function cleanHashTags(n: ParseTree) {
  traverseTree(n, (n) => {
    if (n.type === "Hashtag") {
      n.children = [];
      return true;
    }
    return false;
  });
}

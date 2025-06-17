import type { FrontMatter } from "./frontmatter.ts";
import {
  type ParseTree,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { tagRegex } from "../../web/markdown_parser/constants.ts";
import type { ObjectValue } from "../../type/index.ts";

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

/** Extract the name from hashtag text, removing # prefix and <angle brackets> if necessary */
export function extractHashtag(text: string): string {
  if (text[0] !== "#") { // you shouldn't call this function at all
    console.error("extractHashtag called on already clean string", text);
    return text;
  } else if (text[1] === "<") {
    if (text.slice(-1) !== ">") { // this is malformed: #<name but maybe we're trying to autocomplete
      return text.slice(2);
    } else { // this is correct #<name>
      return text.slice(2, -1);
    }
  } else { // this is just #name
    return text.slice(1);
  }
}

/** Get markup for a hashtag name with # prefix and angle brackets if necessary */
export function renderHashtag(name: string): string {
  // detect with the same regex as the parser
  const simple: string = "#" + name;
  const match = simple.match(tagRegex);
  if (!match || match[0].length !== simple.length) {
    return `#<${name}>`;
  } else return simple;
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

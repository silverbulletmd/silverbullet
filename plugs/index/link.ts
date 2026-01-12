import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { queryLuaObjects } from "./api.ts";
import type { FrontMatter } from "./frontmatter.ts";
import { updateITags } from "./tags.ts";
import {
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { extractSnippetAroundIndex } from "./snippet_extractor.ts";
import {
  mdLinkRegex,
  wikiLinkRegex,
} from "../../client/markdown_parser/constants.ts";
import { lua, space } from "@silverbulletmd/silverbullet/syscalls";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";

export type LinkObject = ObjectValue<
  & {
    // Common to all links
    page: string;
    pos: number;
    snippet: string;
    alias?: string;
  }
  & ({
    // Page Link
    toPage: string;
    toFile?: never;
  } | {
    // Document Link
    toFile: string;
    // The page the link occurs in
    toPage?: never;
  })
>;

/**
 * Represents a page that does not yet exist, but is being linked to. A page "aspiring" to be created.
 */
export type AspiringPageObject = ObjectValue<{
  // ref: page@pos
  // The page the link appears on
  page: string;
  // And the position
  pos: number;
  // The page the link points to
  name: string;
}>;

export async function indexLinks(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
  pageText: string,
) {
  const objects: ObjectValue<any>[] = [];

  // If this is a meta template page, we don't want to index links
  if (frontmatter.tags?.find((t) => t.startsWith("meta/template"))) {
    return [];
  }

  const name = pageMeta.name;

  traverseTree(tree, (n): boolean => {
    // Index [[WikiLinks]]
    if (n.type === "WikiLink") {
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage")!;
      const wikiLinkAlias = findNodeOfType(n, "WikiLinkAlias");
      const url = wikiLinkPage.children![0].text!;
      const pos = wikiLinkPage.from!;

      const link: any = {
        ref: `${name}@${pos}`,
        tag: "link",
        snippet: extractSnippetAroundIndex(pageText, pos),
        pos,
        page: name,
      };

      const ref = parseToRef(url);
      if (!ref) {
        // Invalid links aren't indexed
        return true;
      } else if (isMarkdownPath(ref.path)) {
        link.toPage = getNameFromPath(ref.path);
      } else {
        link.toFile = ref.path;
      }

      if (wikiLinkAlias) {
        link.alias = wikiLinkAlias.children![0].text!;
      }
      updateITags(link, frontmatter);
      objects.push(link);
      return true;
    }

    // Also index [Markdown style]() links
    if (n.type === "Link" || n.type === "Image") {
      // The [[Wiki links]] also have a wrapping Image node, but this just fails at the regex
      mdLinkRegex.lastIndex = 0;
      const match = mdLinkRegex.exec(renderToText(n));
      if (!match) {
        return false;
      }
      let { title: alias, url } = match.groups as {
        url: string;
        title: string;
      };

      // Check if local link
      if (!isLocalURL(url)) {
        return false;
      }
      const pos = n.from!;
      url = resolveMarkdownLink(name, decodeURI(url));

      const link: any = {
        ref: `${name}@${pos}`,
        tag: "link",
        snippet: extractSnippetAroundIndex(pageText, pos),
        pos,
        page: name,
      };

      const ref = parseToRef(url);
      if (!ref) {
        // Invalid links aren't indexed
        return true;
      } else if (isMarkdownPath(ref.path)) {
        link.toPage = getNameFromPath(ref.path);
      } else {
        link.toFile = ref.path;
      }

      if (alias) {
        link.alias = alias;
      }
      updateITags(link, frontmatter);
      objects.push(link);
      return true;
    }

    // Also index links used inside quoted frontmatter strings like "[[Page]]"
    // must match the full string node, only allowing for quotes and whitespace around it
    if (n.type === "FrontMatter") {
      // The YAML in frontmatter is parsed by CodeMirror itself
      for (const textNode of collectNodesOfType(n, "string")) {
        const text = textNode.children![0].text!;
        const trimmed = text.replace(/^["'\s]*/, "").replace(/["'\s]*$/, "");
        // Make sure we search from the beginning, when reusing a Regex object with global flag
        wikiLinkRegex.lastIndex = 0;
        const match = wikiLinkRegex.exec(text);
        // Search in entire node text to get correct position, but check for full match against trimmed
        if (match && match.groups && match[0] === trimmed) {
          const { leadingTrivia, stringRef, alias } = match.groups;
          const pos = textNode.from! + match.index! + leadingTrivia.length;
          const link: any = {
            ref: `${name}@${pos}`,
            tag: "link",
            page: name,
            snippet: extractSnippetAroundIndex(pageText, pos),
            pos: pos,
          };

          const ref = parseToRef(stringRef);
          if (!ref) {
            // Invalid links aren't indexed
            return true;
          } else if (isMarkdownPath(ref.path)) {
            link.toPage = getNameFromPath(ref.path);
          } else {
            link.toFile = ref.path;
          }

          if (alias) {
            link.alias = alias;
          }
          updateITags(link, frontmatter);
          objects.push(link);
        }
      }
    }
    return false;
  });

  // Now let's check which are aspiring pages
  for (const link of objects.slice()) {
    if (link.toPage) {
      if (!await space.fileExists(`${link.toPage}.md`)) {
        objects.push({
          ref: `${name}@${link.pos}`,
          tag: "aspiring-page",
          page: name,
          pos: link.pos,
          name: link.toPage,
        } as AspiringPageObject);
        console.info(
          "Link from",
          name,
          "to",
          link.toPage,
          "is broken, indexing as aspiring page",
        );
      }
    }
  }

  return objects;
}

/**
 * Collects wiki links from a tree
 * @param n
 * @return found links
 */
export function collectPageLinks(n: ParseTree): string[] {
  const links = new Set<string>();
  traverseTree(n, (n) => {
    if (n.type === "WikiLink") {
      links.add(findNodeOfType(n, "WikiLinkPage")!.children![0].text!);
      return true;
    } else if (n.type === "OrderedList" || n.type === "BulletList") {
      // Don't traverse into sub-lists
      return true;
    }
    return false;
  });
  return [...links];
}

export async function getBackLinks(
  name: string,
): Promise<LinkObject[]> {
  return (await queryLuaObjects<LinkObject>("link", {
    objectVariable: "_",
    where: await lua.parseExpression(`_.toPage == name or _.toFile == name`),
  }, {
    name,
  }));
}

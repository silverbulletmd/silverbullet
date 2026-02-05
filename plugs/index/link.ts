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
import type { FrontMatter } from "./frontmatter.ts";
import { updateITags } from "./tags.ts";
import {
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  mdLinkRegex,
  wikiLinkRegex,
} from "../../client/markdown_parser/constants.ts";
import { index, lua, space } from "@silverbulletmd/silverbullet/syscalls";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { extractSnippet } from "./snippet.ts";

export type LinkObject = ObjectValue<{
  // Common to all links
  page: string;
  pos: number;
  type: "page" | "file" | "url";
  snippet: string;
  alias?: string;
  pageLastModified: string;
  // Page Link
  toPage?: string;
  // File Link
  toFile?: string;
  // External URL
  toURL?: string;
}>;

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

      const link: LinkObject = {
        ref: `${name}@${pos}`,
        type: "page", // can be swapped later
        tag: "link",
        snippet: extractSnippet(name, pageText, pos),
        pos,
        range: [n.from!, n.to!],
        page: name,
        pageLastModified: pageMeta.lastModified,
      };

      const ref = parseToRef(url);
      if (!ref) {
        // Invalid links aren't indexed
        return true;
      } else if (isMarkdownPath(ref.path)) {
        link.toPage = getNameFromPath(ref.path);
        link.type = "page";
      } else {
        link.toFile = ref.path;
        link.type = "file";
      }

      if (wikiLinkAlias) {
        link.alias = wikiLinkAlias.children![0].text!;
      }
      updateITags(link as LinkObject, frontmatter);
      objects.push(link);
      return true;
    }

    // Index [markdown style]() links
    if (n.type === "Link" || n.type === "Image") {
      // The [[Wiki links]] also have a wrapping Image node, but this just fails at the regex
      mdLinkRegex.lastIndex = 0;
      const match = mdLinkRegex.exec(renderToText(n));
      if (!match) {
        return false;
      }
      const { title: alias, url } = match.groups as {
        url: string;
        title: string;
      };

      // Check if local link
      const pos = n.from!;
      const link: LinkObject = {
        ref: `${name}@${pos}`,
        tag: "link",
        type: "page", // swapped out later if needed
        snippet: extractSnippet(name, pageText, pos),
        pos,
        range: [n.from!, n.to!],
        page: name,
        pageLastModified: pageMeta.lastModified,
      };

      if (isLocalURL(url)) {
        const ref = parseToRef(resolveMarkdownLink(name, decodeURI(url)));
        if (!ref) {
          // Invalid links aren't indexed
          return true;
        } else if (isMarkdownPath(ref.path)) {
          link.toPage = getNameFromPath(ref.path);
          link.type = "page";
        } else {
          link.toFile = ref.path;
          link.type = "file";
        }
      } else {
        // External URL
        link.type = "url";
        link.toURL = url;
      }

      if (alias) {
        link.alias = alias;
      }
      updateITags(link as LinkObject, frontmatter);
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
          const link: LinkObject = {
            ref: `${name}@${pos}`,
            tag: "link",
            type: "page", // final value set later
            page: name,
            snippet: extractSnippet(name, pageText, pos),
            pos: pos,
            range: [
              textNode.from! + match.index!,
              textNode.from! + match.index! + match[0].length,
            ],
            pageLastModified: pageMeta.lastModified,
          };

          const ref = parseToRef(stringRef);
          if (!ref) {
            // Invalid links aren't indexed
            return true;
          } else if (isMarkdownPath(ref.path)) {
            link.toPage = getNameFromPath(ref.path);
            link.type = "page";
          } else {
            link.toFile = ref.path;
            link.type = "file";
          }

          if (alias) {
            link.alias = alias;
          }
          updateITags(link as LinkObject, frontmatter);
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
          range: link.range,
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
  return (await index.queryLuaObjects<LinkObject>("link", {
    objectVariable: "_",
    where: await lua.parseExpression(`_.toPage == name or _.toFile == name`),
  }, {
    name,
  }));
}

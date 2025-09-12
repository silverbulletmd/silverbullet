import {
  collectNodesOfType,
  findNodeOfType,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "../../type/event.ts";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { indexObjects, queryLuaObjects } from "./api.ts";
import { extractFrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import {
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { extractSnippetAroundIndex } from "./snippet_extractor.ts";
import {
  mdLinkRegex,
  wikiLinkRegex,
} from "../../web/markdown_parser/constants.ts";
import { lua, space } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "../../type/index.ts";

export type LinkObject = ObjectValue<
  {
    //Page Link
    // The page the link points to
    toPage: string;
    // The page the link occurs in
    page: string;
    pos: number;
    snippet: string;
    alias?: string;
    asTemplate: boolean;
    toFile?: never;
  } | {
    // Document Link
    // The file the link points to
    toFile: string;
    // The page the link occurs in
    page: string;
    pos: number;
    snippet: string;
    alias?: string;
    asTemplate: boolean;
    toPage?: never;
  }
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

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const links: ObjectValue<LinkObject>[] = [];
  const frontmatter = await extractFrontMatter(tree);
  const pageText = renderToText(tree);

  // If this is a meta template page, we don't want to index links
  if (frontmatter.tags?.find((t) => t.startsWith("meta/template"))) {
    return;
  }

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
        asTemplate: false,
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
      links.push(link);
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
        asTemplate: false,
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
      links.push(link);
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
            asTemplate: false,
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
          links.push(link);
        }
      }
    }
    return false;
  });

  // console.log("Found", links, "page link(s)");
  if (links.length > 0) {
    await indexObjects(name, links);
  }

  // Now let's check which are aspiring pages
  const aspiringPages: ObjectValue<AspiringPageObject>[] = [];
  for (const link of links) {
    if (link.toPage) {
      if (!await space.fileExists(`${link.toPage}.md`)) {
        aspiringPages.push({
          ref: `${name}@${link.pos}`,
          tag: "aspiring-page",
          page: name,
          pos: link.pos,
          name: link.toPage,
        } as AspiringPageObject);
      }
    }
  }

  if (aspiringPages.length > 0) {
    await indexObjects(name, aspiringPages);
  }
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

import {
  findNodeOfType,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  IndexTreeEvent,
  ObjectValue,
} from "@silverbulletmd/silverbullet/types";
import {
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { indexObjects, queryObjects } from "./api.ts";
import { extractFrontmatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import {
  looksLikePathWithExtension,
  parsePageRef,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import { extractSnippetAroundIndex } from "./snippet_extractor.ts";
import {
  mdLinkRegex,
  wikiLinkRegex,
} from "$common/markdown_parser/constants.ts";

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
    // Attachment Link
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

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const links: ObjectValue<LinkObject>[] = [];
  const frontmatter = await extractFrontmatter(tree);
  const pageText = renderToText(tree);

  traverseTree(tree, (n): boolean => {
    // Index [[WikiLinks]]
    if (n.type === "WikiLink") {
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage")!;
      const wikiLinkAlias = findNodeOfType(n, "WikiLinkAlias");
      const url = resolvePath(name, "/" + wikiLinkPage.children![0].text!);
      const pos = wikiLinkPage.from!;

      const link: any = {
        ref: `${name}@${pos}`,
        tag: "link",
        snippet: extractSnippetAroundIndex(pageText, pos),
        pos,
        page: name,
        asTemplate: false,
      };
      // Assume link is to an attachment if it has
      // an extension, to a page otherwise
      if (looksLikePathWithExtension(url)) {
        link.toFile = url;
      } else {
        link.toPage = parsePageRef(url).page;
      }
      if (wikiLinkAlias) {
        link.alias = wikiLinkAlias.children![0].text!;
      }
      updateITags(link, frontmatter);
      links.push(link);
      return true;
    }

    // Also index [Markdown style]() links
    if (n.type === "URL") {
      const linkNode = findNodeOfType(n, "URL")!;
      if (!linkNode) {
        return false;
      }
      const text = /\[(?<title>[^\]]*)\]\((?<url>.+)\)/
        .exec(renderToText(linkNode.parent));
      if (!text) {
        return false;
      }
      let [/* fullMatch */, alias, url] = text;

      // Check if local link
      if (!isLocalPath(url)) {
        return false;
      }
      const pos = linkNode.from!;
      url = resolvePath(name, decodeURI(url));

      const link: any = {
        ref: `${name}@${pos}`,
        tag: "link",
        snippet: extractSnippetAroundIndex(pageText, pos),
        pos,
        page: name,
        asTemplate: false,
      };
      // Assume link is to an attachment if it has
      // an extension, to a page otherwise
      if (looksLikePathWithExtension(url)) {
        link.toFile = url;
      } else {
        link.toPage = parsePageRef(url).page;
      }
      if (alias) {
        link.alias = alias;
      }
      updateITags(link, frontmatter);
      links.push(link);
      return true;
    }

    // Also index links used inside query and template fenced code blocks
    if (n.type === "FencedCode") {
      const codeInfo = findNodeOfType(n, "CodeInfo")!;
      if (!codeInfo) {
        return false;
      }
      const codeLang = codeInfo.children![0].text!;
      if (codeLang === "template" || codeLang === "query") {
        const codeText = findNodeOfType(n, "CodeText");
        if (!codeText) {
          return false;
        }
        const code = codeText.children![0].text!;
        const wikiLinkMatches = code.matchAll(wikiLinkRegex);
        for (const match of wikiLinkMatches) {
          const [_fullMatch, firstMark, url, alias, _lastMark] = match;
          const pos = codeText.from! + match.index! + firstMark.length;
          const link: any = {
            ref: `${name}@${pos}`,
            tag: "link",
            page: name,
            snippet: extractSnippetAroundIndex(pageText, pos),
            pos: pos,
            asTemplate: true,
          };
          // Assume link is to an attachment if it has
          // an extension, to a page otherwise
          if (looksLikePathWithExtension(url)) {
            link.toFile = resolvePath(name, "/" + url);
          } else {
            link.toPage = resolvePath(name, "/" + parsePageRef(url).page);
          }
          if (alias) {
            link.alias = alias;
          }
          updateITags(link, frontmatter);
          links.push(link);
        }
        const mdLinkMatches = code.matchAll(mdLinkRegex);
        for (const match of mdLinkMatches) {
          const [_fullMatch, alias, url] = match;
          const pos = codeText.from! + match.index! + 1;
          const link: any = {
            ref: `${name}@${pos}`,
            tag: "link",
            page: name,
            snippet: extractSnippetAroundIndex(pageText, pos),
            pos: pos,
            asTemplate: true,
          };
          if (looksLikePathWithExtension(url)) {
            link.toFile = resolvePath(name, url);
          } else {
            link.toPage = resolvePath(name, parsePageRef(url).page);
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
  await indexObjects(name, links);
}

export async function getBackLinks(
  name: string,
): Promise<LinkObject[]> {
  return (await queryObjects<LinkObject>("link", {
    filter: ["or", ["=", ["attr", "toPage"], ["string", name]], ["=", [
      "attr",
      "toFile",
    ], ["string", name]]],
  }));
}

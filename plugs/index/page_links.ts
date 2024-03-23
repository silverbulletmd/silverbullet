import { findNodeOfType, renderToText, traverseTree } from "$sb/lib/tree.ts";
import { IndexTreeEvent } from "../../plug-api/types.ts";
import { resolveAttachmentPath, resolvePath } from "$sb/lib/resolve.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { ObjectValue } from "../../plug-api/types.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { updateITags } from "$sb/lib/tags.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";
import { extractSnippetAroundIndex } from "./snippet_extractor.ts";

const pageRefRegex = /\[\[([^\]]+)\]\]/g;

export type LinkObject = ObjectValue<
  {
    // The page the link points to
    toPage: string;
    // The page the link occurs in
    page: string;
    pos: number;
    snippet: string;
    alias?: string;
    asTemplate: boolean;
  }
>;

export type AttachmentLinkObject = ObjectValue<
  {
    // The file the link points to
    toFile: string;
    // The page the link occurs in
    page: string;
    pos: number;
    snippet: string;
  }
>;

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const links: ObjectValue<LinkObject>[] = [];
  const attachmentLinks: ObjectValue<AttachmentLinkObject>[] = [];
  // [[Style Links]]
  // console.log("Now indexing links for", name);
  const frontmatter = await extractFrontmatter(tree);
  const pageText = renderToText(tree);

  traverseTree(tree, (n): boolean => {
    if (n.type === "WikiLink") {
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage")!;
      const wikiLinkAlias = findNodeOfType(n, "WikiLinkAlias");
      let toPage = resolvePath(name, wikiLinkPage.children![0].text!);
      const pos = wikiLinkPage.from!;
      toPage = parsePageRef(toPage).page;
      const link: LinkObject = {
        ref: `${name}@${pos}`,
        tag: "link",
        toPage: toPage,
        snippet: extractSnippetAroundIndex(pageText, pos),
        pos,
        page: name,
        asTemplate: false,
      };
      if (wikiLinkAlias) {
        link.alias = wikiLinkAlias.children![0].text!;
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
        const matches = code.matchAll(pageRefRegex);
        for (const match of matches) {
          const pageRefName = resolvePath(name, parsePageRef(match[1]).page);
          const pos = codeText.from! + match.index! + 2;
          const link = {
            ref: `${name}@${pos}`,
            tag: "link",
            toPage: pageRefName,
            page: name,
            snippet: extractSnippetAroundIndex(pageText, pos),
            pos: pos,
            asTemplate: true,
          };
          updateITags(link, frontmatter);
          links.push(link);
        }
      }
    }

    // Also index []() style links
    if (n.type === "URL") {
      const linkNode = findNodeOfType(n, "URL")!;
      if (!linkNode) {
        return false;
      }

      // Check if local link
      let url = linkNode.children![0].text!;
      url = url.replace(/^\//g, "");
      if (
        !url || url.indexOf("://") >= 0 ||
        url.startsWith("mailto:") || url.startsWith("!")
      ) {
        return false;
      }
      const pos = linkNode.from!;

      // Assume link is to an attachment if it has
      // an extension, to a page otherwise
      if (/\.[a-zA-Z0-9]+$/.test(url)) {
        url = resolveAttachmentPath(name, url);
        const link: AttachmentLinkObject = {
          ref: `${name}@${pos}`,
          tag: "attachment",
          toFile: url,
          snippet: extractSnippetAroundIndex(pageText, pos),
          pos,
          page: name,
        };
        updateITags(link, frontmatter);
        attachmentLinks.push(link);
        return true;
      } else {
        url = resolvePath(name, decodeURI(url));
        url = parsePageRef(url).page;
        const link: LinkObject = {
          ref: `${name}@${pos}`,
          tag: "link",
          toPage: url,
          snippet: extractSnippetAroundIndex(pageText, pos),
          pos,
          page: name,
          asTemplate: false,
        };
        updateITags(link, frontmatter);
        links.push(link);
        return true;
      }
    }
    return false;
  });
  // console.log("Found", links, "page link(s)");
  await indexObjects(name, links);
  await indexObjects(name, attachmentLinks);
}

export async function getBackLinks(
  pageName: string,
): Promise<LinkObject[]> {
  return (await queryObjects<LinkObject>("link", {
    filter: ["=", ["attr", "toPage"], ["string", pageName]],
  }));
}

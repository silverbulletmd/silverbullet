import { findNodeOfType, renderToText, traverseTree } from "$sb/lib/tree.ts";
import { AttachmentMeta, IndexTreeEvent } from "../../plug-api/types.ts";
import { resolvePath } from "$sb/lib/resolve.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { ObjectValue } from "../../plug-api/types.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { updateITags } from "$sb/lib/tags.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";
import { extractSnippetAroundIndex } from "./snippet_extractor.ts";
import { space } from "$sb/syscalls.ts";

const pageRefRegex = /\[\[([^\]]+)\]\]/g;

// Link can be to a page or to an attachment
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

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const links: ObjectValue<LinkObject>[] = [];
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
      if (
        url.indexOf("://") >= 0 || url.startsWith("mailto:") ||
        url.startsWith("!")
      ) {
        return false;
      }
      url = resolvePath(name, decodeURI(url));

      const pos = linkNode.from!;
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
    return false;
  });
  // console.log("Found", links, "page link(s)");
  await indexObjects(name, links);
}

export async function getBackLinks(
  pageName: string,
): Promise<LinkObject[]> {
  return (await queryObjects<LinkObject>("link", {
    filter: ["=", ["attr", "toPage"], ["string", pageName]],
  }));
}

// Get list of attachments and any links that point to them
type AttachmentLinks = AttachmentMeta & {
  links?: LinkObject[];
};

export async function getAttachmentsWithLinks(): Promise<AttachmentLinks[]> {
  //let attachments: AttachmentLinks[] = [];
  const attachments: AttachmentLinks[] = await space.listAttachments();
  const links = await queryObjects<LinkObject>("link", {});
  for (let att of attachments) {
    const linksTo = links.filter((l) => l.toPage === att.name);
    att.links?.concat(linksTo);
  }
  return attachments;
}

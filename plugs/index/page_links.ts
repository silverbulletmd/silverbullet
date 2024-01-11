import { findNodeOfType, renderToText, traverseTree } from "$sb/lib/tree.ts";
import { IndexTreeEvent } from "$sb/app_event.ts";
import { resolvePath } from "$sb/lib/resolve.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { ObjectValue } from "$sb/types.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { updateITags } from "$sb/lib/tags.ts";

const pageRefRegex = /\[\[([^\]]+)\]\]/g;

export type LinkObject = ObjectValue<{
  // The page the link points to
  toPage: string;
  // The page the link occurs in
  page: string;
  pos: number;
  snippet: string;
  alias?: string;
  asTemplate: boolean;
}>;

export function extractSnippet(text: string, pos: number): string {
  let prefix = "";
  for (let i = pos - 1; i > 0; i--) {
    if (text[i] === "\n") {
      break;
    }
    prefix = text[i] + prefix;
    if (prefix.length > 25) {
      break;
    }
  }
  let suffix = "";
  for (let i = pos; i < text.length; i++) {
    if (text[i] === "\n") {
      break;
    }
    suffix += text[i];
    if (suffix.length > 25) {
      break;
    }
  }
  return prefix + suffix;
}

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
      toPage = toPage.split(/[@$]/)[0];
      const link: LinkObject = {
        ref: `${name}@${pos}`,
        tag: "link",
        toPage: toPage,
        snippet: extractSnippet(pageText, pos),
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
          const pageRefName = resolvePath(name, match[1]);
          const pos = codeText.from! + match.index! + 2;
          const link = {
            ref: `${name}@${pos}`,
            tag: "link",
            toPage: pageRefName,
            page: name,
            snippet: extractSnippet(pageText, pos),
            pos: pos,
            asTemplate: true,
          };
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
  pageName: string,
): Promise<LinkObject[]> {
  return (await queryObjects<LinkObject>("link", {
    filter: ["=", ["attr", "toPage"], ["string", pageName]],
  }));
}

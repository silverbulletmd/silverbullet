import { findNodeOfType, renderToText, traverseTree } from "$sb/lib/tree.ts";
import { IndexTreeEvent } from "$sb/app_event.ts";
import { resolvePath } from "$sb/lib/resolve.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { ObjectValue } from "$sb/types.ts";

export type LinkObject = {
  ref: string;
  tags: string[];
  // The page the link points to
  toPage: string;
  // The page the link occurs in
  page: string;
  pos: number;
  snippet: string;
  alias?: string;
  inDirective: boolean;
  asTemplate: boolean;
};

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

  const pageText = renderToText(tree);

  let directiveDepth = 0;
  traverseTree(tree, (n): boolean => {
    if (n.type === "DirectiveStart") {
      directiveDepth++;
      const pageRef = findNodeOfType(n, "PageRef")!;
      if (pageRef) {
        const pageRefName = resolvePath(
          name,
          pageRef.children![0].text!.slice(2, -2),
        );
        const pos = pageRef.from! + 2;
        links.push({
          ref: `${name}@${pos}`,
          tags: ["link"],
          toPage: pageRefName,
          pos: pos,
          snippet: extractSnippet(pageText, pos),
          page: name,
          asTemplate: true,
          inDirective: false,
        });
      }
      const directiveText = n.children![0].text;
      // #use or #import
      if (directiveText) {
        const match = /\[\[(.+)\]\]/.exec(directiveText);
        if (match) {
          const pageRefName = resolvePath(name, match[1]);
          const pos = n.from! + match.index! + 2;
          links.push({
            ref: `${name}@${pos}`,
            tags: ["link"],
            toPage: pageRefName,
            page: name,
            snippet: extractSnippet(pageText, pos),
            pos: pos,
            asTemplate: true,
            inDirective: false,
          });
        }
      }

      return true;
    }
    if (n.type === "DirectiveEnd") {
      directiveDepth--;
      return true;
    }

    if (n.type === "WikiLink") {
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage")!;
      const wikiLinkAlias = findNodeOfType(n, "WikiLinkAlias");
      let toPage = resolvePath(name, wikiLinkPage.children![0].text!);
      const pos = wikiLinkPage.from!;
      toPage = toPage.split(/[@$]/)[0];
      const link: LinkObject = {
        ref: `${name}@${pos}`,
        tags: ["link"],
        toPage: toPage,
        snippet: extractSnippet(pageText, pos),
        pos,
        page: name,
        inDirective: false,
        asTemplate: false,
      };
      if (directiveDepth > 0) {
        link.inDirective = true;
      }
      if (wikiLinkAlias) {
        link.alias = wikiLinkAlias.children![0].text!;
      }
      links.push(link);
      return true;
    }
    return false;
  });
  // console.log("Found", backLinks, "page link(s)");
  await indexObjects(name, links);
}

export async function getBackLinks(
  pageName: string,
): Promise<LinkObject[]> {
  return (await queryObjects<LinkObject>("link", {
    filter: ["=", ["attr", "toPage"], ["string", pageName]],
  }));
}

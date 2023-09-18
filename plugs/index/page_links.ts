import { findNodeOfType, traverseTree } from "$sb/lib/tree.ts";
import { IndexTreeEvent } from "$sb/app_event.ts";
import { resolvePath } from "$sb/lib/resolve.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { ObjectValue } from "$sb/types.ts";

export type LinkObject = {
  // The page the link points to
  name: string;
  // The page the link occurs in
  page: string;
  pos: number;
  alias?: string;
  inDirective?: boolean;
  asTemplate?: boolean;
};

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const backLinks: ObjectValue<LinkObject>[] = [];
  // [[Style Links]]
  // console.log("Now indexing links for", name);

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
        backLinks.push({
          key: [pageRefName, "" + pos],
          tags: ["link"],
          value: { name: pageRefName, pos, page: name, asTemplate: true },
        });
      }
      const directiveText = n.children![0].text;
      // #use or #import
      if (directiveText) {
        const match = /\[\[(.+)\]\]/.exec(directiveText);
        if (match) {
          const pageRefName = resolvePath(name, match[1]);
          const pos = n.from! + match.index! + 2;
          backLinks.push({
            key: [pageRefName, "" + pos],
            tags: ["link"],
            value: { name: pageRefName, page: name, pos, asTemplate: true },
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
      if (toPage.includes("@")) {
        toPage = toPage.split("@")[0];
      }
      const blEntry: LinkObject = { name: toPage, pos, page: name };
      if (directiveDepth > 0) {
        blEntry.inDirective = true;
      }
      if (wikiLinkAlias) {
        blEntry.alias = wikiLinkAlias.children![0].text!;
      }
      backLinks.push({
        key: [toPage, "" + pos],
        tags: ["link"],
        value: blEntry,
      });
      return true;
    }
    return false;
  });
  // console.log("Found", backLinks, "page link(s)");
  await indexObjects(name, backLinks);
}

export async function getBackLinks(
  pageName: string,
): Promise<LinkObject[]> {
  return (await queryObjects<LinkObject>("link", {
    prefix: [pageName],
  })).map((bl) => bl.value);
}

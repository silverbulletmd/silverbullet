import { index } from "$sb/silverbullet-syscall/mod.ts";
import { findNodeOfType, traverseTree } from "$sb/lib/tree.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";
import { applyQuery } from "$sb/lib/query.ts";

// Key space:
//   l:toPage:pos => {name: pageName, inDirective: true, asTemplate: true}

export const backlinkPrefix = `l:`;

export type BacklinkEntry = {
  name: string;
  alias?: string;
  inDirective?: boolean;
  asTemplate?: boolean;
};

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const backLinks: { key: string; value: BacklinkEntry }[] = [];
  // [[Style Links]]
  // console.log("Now indexing links for", name);
  const pageMeta = await extractFrontmatter(tree);
  const toplevelAttributes = await extractAttributes(tree, false);
  if (
    Object.keys(pageMeta).length > 0 ||
    Object.keys(toplevelAttributes).length > 0
  ) {
    for (const [k, v] of Object.entries(toplevelAttributes)) {
      pageMeta[k] = v;
    }
    // Don't index meta data starting with $
    for (const key in pageMeta) {
      if (key.startsWith("$")) {
        delete pageMeta[key];
      }
    }
    // console.log("Extracted page meta data", pageMeta);
    await index.set(name, "meta:", pageMeta);
  }

  let directiveDepth = 0;
  traverseTree(tree, (n): boolean => {
    if (n.type === "DirectiveStart") {
      directiveDepth++;
      const pageRef = findNodeOfType(n, "PageRef")!;
      if (pageRef) {
        const pageRefName = pageRef.children![0].text!.slice(2, -2);
        backLinks.push({
          key: `${backlinkPrefix}${pageRefName}:${pageRef.from! + 2}`,
          value: { name, asTemplate: true },
        });
      }
      const directiveText = n.children![0].text;
      // #use or #import
      if (directiveText) {
        const match = /\[\[(.+)\]\]/.exec(directiveText);
        if (match) {
          const pageRefName = match[1];
          backLinks.push({
            key: `${backlinkPrefix}${pageRefName}:${
              n.from! + match.index! + 2
            }`,
            value: { name, asTemplate: true },
          });
        }
      }

      return true;
    }
    if (n.type === "DirectiveStop") {
      directiveDepth--;
      return true;
    }

    if (n.type === "WikiLink") {
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage")!;
      const wikiLinkAlias = findNodeOfType(n, "WikiLinkAlias");
      let toPage = wikiLinkPage.children![0].text!;
      if (toPage.includes("@")) {
        toPage = toPage.split("@")[0];
      }
      const blEntry: BacklinkEntry = { name };
      if (directiveDepth > 0) {
        blEntry.inDirective = true;
      }
      if (wikiLinkAlias) {
        blEntry.alias = wikiLinkAlias.children![0].text!;
      }
      backLinks.push({
        key: `${backlinkPrefix}${toPage}:${wikiLinkPage.from}`,
        value: blEntry,
      });
      return true;
    }
    return false;
  });
  // console.log("Found", backLinks.length, "page link(s)");
  await index.batchSet(name, backLinks);
}

export async function linkQueryProvider({
  query,
  pageName,
}: QueryProviderEvent): Promise<any[]> {
  const links: any[] = [];
  for (
    const { value: blEntry, key } of await index.queryPrefix(
      `${backlinkPrefix}${pageName}:`,
    )
  ) {
    const [, , pos] = key.split(":"); // Key: l:page:pos
    if (!blEntry.inDirective) {
      blEntry.inDirective = false;
    }
    if (!blEntry.asTemplate) {
      blEntry.asTemplate = false;
    }
    links.push({ ...blEntry, pos });
  }
  return applyQuery(query, links);
}

type BackLinkPage = {
  page: string;
  pos: number;
};

export async function getBackLinks(pageName: string): Promise<BackLinkPage[]> {
  const allBackLinks = await index.queryPrefix(
    `${backlinkPrefix}${pageName}:`,
  );
  const pagesToUpdate: BackLinkPage[] = [];
  for (const { key, value: { name } } of allBackLinks) {
    const keyParts = key.split(":");
    pagesToUpdate.push({
      page: name,
      pos: +keyParts[keyParts.length - 1],
    });
  }
  return pagesToUpdate;
}

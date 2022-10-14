import type {
  IndexEvent,
  IndexTreeEvent,
  QueryProviderEvent,
} from "$sb/app_event.ts";
import {
  editor,
  index,
  markdown,
  space,
  system,
} from "$sb/silverbullet-syscall/mod.ts";

import { events, store } from "$sb/plugos-syscall/mod.ts";

import {
  addParentPointers,
  collectNodesMatching,
  ParseTree,
  renderToText,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";
import { applyQuery } from "$sb/lib/query.ts";
import { extractMeta } from "../query/data.ts";

// Key space:
//   pl:toPage:pos => pageName
//   meta => metaJson

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const backLinks: { key: string; value: string }[] = [];
  // [[Style Links]]
  console.log("Now indexing", name);
  const pageMeta = extractMeta(tree);
  if (Object.keys(pageMeta).length > 0) {
    console.log("Extracted page meta data", pageMeta);
    // Don't index meta data starting with $
    for (const key in pageMeta) {
      if (key.startsWith("$")) {
        delete pageMeta[key];
      }
    }
    await index.set(name, "meta:", pageMeta);
  }

  collectNodesMatching(tree, (n) => n.type === "WikiLinkPage").forEach((n) => {
    let toPage = n.children![0].text!;
    if (toPage.includes("@")) {
      toPage = toPage.split("@")[0];
    }
    backLinks.push({
      key: `pl:${toPage}:${n.from}`,
      value: name,
    });
  });
  console.log("Found", backLinks.length, "wiki link(s)");
  await index.batchSet(name, backLinks);
}

export async function pageQueryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let allPages = await space.listPages();
  const allPageMap: Map<string, any> = new Map(
    allPages.map((pm) => [pm.name, pm]),
  );
  for (const { page, value } of await index.queryPrefix("meta:")) {
    const p = allPageMap.get(page);
    if (p) {
      for (let [k, v] of Object.entries(value)) {
        p[k] = v;
      }
    }
  }
  allPages = [...allPageMap.values()];
  return applyQuery(query, allPages);
}

export async function linkQueryProvider({
  query,
  pageName,
}: QueryProviderEvent): Promise<any[]> {
  const links: any[] = [];
  for (
    const { value: name, key } of await index.queryPrefix(`pl:${pageName}:`)
  ) {
    const [, , pos] = key.split(":"); // Key: pl:page:pos
    links.push({ name, pos });
  }
  return applyQuery(query, links);
}

export async function deletePage() {
  const pageName = await editor.getCurrentPage();
  console.log("Navigating to index page");
  await editor.navigate("");
  console.log("Deleting page from space");
  await space.deletePage(pageName);
}

export async function renamePage() {
  const oldName = await editor.getCurrentPage();
  const cursor = await editor.getCursor();
  console.log("Old name is", oldName);
  const newName = await editor.prompt(`Rename ${oldName} to:`, oldName);
  if (!newName) {
    return;
  }

  if (newName.trim() === oldName.trim()) {
    return;
  }
  console.log("New name", newName);

  const pagesToUpdate = await getBackLinks(oldName);
  console.log("All pages containing backlinks", pagesToUpdate);

  const text = await editor.getText();
  console.log("Writing new page to space");
  await space.writePage(newName, text);
  console.log("Navigating to new page");
  await editor.navigate(newName, cursor, true);
  console.log("Deleting page from space");
  await space.deletePage(oldName);

  const pageToUpdateSet = new Set<string>();
  for (const pageToUpdate of pagesToUpdate) {
    pageToUpdateSet.add(pageToUpdate.page);
  }

  for (const pageToUpdate of pageToUpdateSet) {
    if (pageToUpdate === oldName) {
      continue;
    }
    console.log("Now going to update links in", pageToUpdate);
    const text = await space.readPage(pageToUpdate);
    // console.log("Received text", text);
    if (!text) {
      // Page likely does not exist, but at least we can skip it
      continue;
    }
    const mdTree = await markdown.parseMarkdown(text);
    addParentPointers(mdTree);
    replaceNodesMatching(mdTree, (n): ParseTree | undefined | null => {
      if (n.type === "WikiLinkPage") {
        const pageName = n.children![0].text!;
        if (pageName === oldName) {
          n.children![0].text = newName;
          return n;
        }
        // page name with @pos position
        if (pageName.startsWith(`${oldName}@`)) {
          const [, pos] = pageName.split("@");
          n.children![0].text = `${newName}@${pos}`;
          return n;
        }
      }
      return;
    });
    // let newText = text.replaceAll(`[[${oldName}]]`, `[[${newName}]]`);
    const newText = renderToText(mdTree);
    if (text !== newText) {
      console.log("Changes made, saving...");
      await space.writePage(pageToUpdate, newText);
    }
  }
}

type BackLink = {
  page: string;
  pos: number;
};

async function getBackLinks(pageName: string): Promise<BackLink[]> {
  const allBackLinks = await index.queryPrefix(`pl:${pageName}:`);
  const pagesToUpdate: BackLink[] = [];
  for (const { key, value } of allBackLinks) {
    const keyParts = key.split(":");
    pagesToUpdate.push({
      page: value,
      pos: +keyParts[keyParts.length - 1],
    });
  }
  return pagesToUpdate;
}

export async function reindexCommand() {
  await editor.flashNotification("Reindexing...");
  await system.invokeFunction("server", "reindexSpace");
  await editor.flashNotification("Reindexing done");
}

// Completion
export async function pageComplete() {
  const prefix = await editor.matchBefore("\\[\\[[^\\]@:]*");
  if (!prefix) {
    return null;
  }
  const allPages = await space.listPages();
  return {
    from: prefix.from + 2,
    options: allPages.map((pageMeta) => ({
      label: pageMeta.name,
      type: "page",
    })),
  };
}

// Server functions
export async function reindexSpace() {
  console.log("Clearing page index...");
  await index.clearPageIndex();
  console.log("Listing all pages");
  const pages = await space.listPages();
  for (const { name } of pages) {
    console.log("Indexing", name);
    const text = await space.readPage(name);
    const parsed = await markdown.parseMarkdown(text);
    await events.dispatchEvent("page:index", {
      name,
      tree: parsed,
    });
  }
  console.log("Indexing completed!");
}

export async function clearPageIndex(page: string) {
  console.log("Clearing page index for page", page);
  await index.clearPageIndexForPage(page);
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  await events.dispatchEvent("page:index", {
    name,
    tree: await markdown.parseMarkdown(text),
  });
}

import type { IndexEvent, IndexTreeEvent } from "@silverbulletmd/web/app_event";
import {
  batchSet,
  clearPageIndex as clearPageIndexSyscall,
  clearPageIndexForPage,
  queryPrefix,
  set,
} from "@silverbulletmd/plugos-silverbullet-syscall/index";

import { set as storeSet } from "@plugos/plugos-syscall/store";

import {
  flashNotification,
  getCurrentPage,
  getCursor,
  getText,
  matchBefore,
  navigate,
  prompt,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";

import { dispatch } from "@plugos/plugos-syscall/event";
import {
  deletePage as deletePageSyscall,
  listPages,
  readPage,
  writePage,
} from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import {
  addParentPointers,
  collectNodesMatching,
  ParseTree,
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/common/tree";
import { applyQuery, QueryProviderEvent } from "../query/engine";
import { extractMeta } from "../query/data";

// Key space:
//   pl:toPage:pos => pageName
//   meta => metaJson

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  let backLinks: { key: string; value: string }[] = [];
  // [[Style Links]]
  console.log("Now indexing", name);
  let pageMeta = extractMeta(tree);
  if (Object.keys(pageMeta).length > 0) {
    console.log("Extracted page meta data", pageMeta);
    await set(name, "meta:", pageMeta);
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
  await batchSet(name, backLinks);
}

export async function pageQueryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let allPages = await listPages();
  let allPageMap: Map<string, any> = new Map(
    allPages.map((pm) => [pm.name, pm])
  );
  for (let { page, value } of await queryPrefix("meta:")) {
    let p = allPageMap.get(page);
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
  let links: any[] = [];
  for (let { value: name, key } of await queryPrefix(`pl:${pageName}:`)) {
    const [, , pos] = key.split(":"); // Key: pl:page:pos
    links.push({ name, pos });
  }
  return applyQuery(query, links);
}

export async function deletePage() {
  let pageName = await getCurrentPage();
  console.log("Navigating to index page");
  await navigate("");
  console.log("Deleting page from space");
  await deletePageSyscall(pageName);
}

export async function renamePage() {
  const oldName = await getCurrentPage();
  const cursor = await getCursor();
  console.log("Old name is", oldName);
  const newName = await prompt(`Rename ${oldName} to:`, oldName);
  if (!newName) {
    return;
  }

  if (newName.trim() === oldName.trim()) {
    return;
  }
  console.log("New name", newName);

  let pagesToUpdate = await getBackLinks(oldName);
  console.log("All pages containing backlinks", pagesToUpdate);

  let text = await getText();
  console.log("Writing new page to space");
  await writePage(newName, text);
  console.log("Navigating to new page");
  await navigate(newName, cursor, true);
  console.log("Deleting page from space");
  await deletePageSyscall(oldName);

  let pageToUpdateSet = new Set<string>();
  for (let pageToUpdate of pagesToUpdate) {
    pageToUpdateSet.add(pageToUpdate.page);
  }

  for (let pageToUpdate of pageToUpdateSet) {
    if (pageToUpdate === oldName) {
      continue;
    }
    console.log("Now going to update links in", pageToUpdate);
    let { text } = await readPage(pageToUpdate);
    // console.log("Received text", text);
    if (!text) {
      // Page likely does not exist, but at least we can skip it
      continue;
    }
    let mdTree = await parseMarkdown(text);
    addParentPointers(mdTree);
    replaceNodesMatching(mdTree, (n): ParseTree | undefined | null => {
      if (n.type === "WikiLinkPage") {
        let pageName = n.children![0].text!;
        if (pageName === oldName) {
          n.children![0].text = newName;
          return n;
        }
        // page name with @pos position
        if (pageName.startsWith(`${oldName}@`)) {
          let [, pos] = pageName.split("@");
          n.children![0].text = `${newName}@${pos}`;
          return n;
        }
      }
      return;
    });
    // let newText = text.replaceAll(`[[${oldName}]]`, `[[${newName}]]`);
    let newText = renderToText(mdTree);
    if (text !== newText) {
      console.log("Changes made, saving...");
      await writePage(pageToUpdate, newText);
    }
  }
}

type BackLink = {
  page: string;
  pos: number;
};

async function getBackLinks(pageName: string): Promise<BackLink[]> {
  let allBackLinks = await queryPrefix(`pl:${pageName}:`);
  let pagesToUpdate: BackLink[] = [];
  for (let { key, value } of allBackLinks) {
    let keyParts = key.split(":");
    pagesToUpdate.push({
      page: value,
      pos: +keyParts[keyParts.length - 1],
    });
  }
  return pagesToUpdate;
}

export async function reindexCommand() {
  await flashNotification("Reindexing...");
  await invokeFunction("server", "reindexSpace");
  await storeSet("$spaceIndexed", true);
  await flashNotification("Reindexing done");
}

// Completion
export async function pageComplete() {
  let prefix = await matchBefore("\\[\\[[^\\]]*");
  if (!prefix) {
    return null;
  }
  let allPages = await listPages();
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
  await clearPageIndexSyscall();
  console.log("Listing all pages");
  let pages = await listPages();
  for (let { name } of pages) {
    console.log("Indexing", name);
    const { text } = await readPage(name);
    let parsed = await parseMarkdown(text);
    await dispatch("page:index", {
      name,
      tree: parsed,
    });
  }
}

export async function clearPageIndex(page: string) {
  console.log("Clearing page index for page", page);
  await clearPageIndexForPage(page);
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  await dispatch("page:index", {
    name,
    tree: await parseMarkdown(text),
  });
}

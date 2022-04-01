import { IndexEvent } from "../../webapp/app_event";
import { pageLinkRegex } from "../../webapp/constant";
import {
  batchSet,
  clearPageIndex as clearPageIndexSyscall,
  clearPageIndexForPage,
  scanPrefixGlobal,
} from "plugos-silverbullet-syscall/index";
import {
  flashNotification,
  getCurrentPage,
  getText,
  matchBefore,
  navigate,
} from "plugos-silverbullet-syscall/editor";

import { dispatch } from "plugos-syscall/event";
import {
  deletePage as deletePageSyscall,
  listPages,
  readPage,
  writePage,
} from "plugos-silverbullet-syscall/space";
import { invokeFunctionOnServer } from "plugos-silverbullet-syscall/system";

const wikilinkRegex = new RegExp(pageLinkRegex, "g");

export async function indexLinks({ name, text }: IndexEvent) {
  let backLinks: { key: string; value: string }[] = [];
  // [[Style Links]]
  console.log("Now indexing", name);
  for (let match of text.matchAll(wikilinkRegex)) {
    let toPage = match[1];
    if (toPage.includes("@")) {
      toPage = toPage.split("@")[0];
    }
    let pos = match.index!;
    backLinks.push({
      key: `pl:${toPage}:${pos}`,
      value: name,
    });
  }
  console.log("Found", backLinks.length, "wiki link(s)");
  await batchSet(name, backLinks);
}

export async function deletePage() {
  let pageName = await getCurrentPage();
  console.log("Navigating to start page");
  await navigate("start");
  console.log("Deleting page from space");
  await deletePageSyscall(pageName);
}

export async function renamePage() {
  const oldName = await getCurrentPage();
  console.log("Old name is", oldName);
  const newName = await prompt(`Rename ${oldName} to:`, oldName);
  if (!newName) {
    return;
  }
  console.log("New name", newName);

  let pagesToUpdate = await getBackLinks(oldName);
  console.log("All pages containing backlinks", pagesToUpdate);

  let text = await getText();
  console.log("Writing new page to space");
  await writePage(newName, text);
  console.log("Navigating to new page");
  await navigate(newName);
  console.log("Deleting page from space");
  await deletePageSyscall(oldName);

  let pageToUpdateSet = new Set<string>();
  for (let pageToUpdate of pagesToUpdate) {
    pageToUpdateSet.add(pageToUpdate.page);
  }

  for (let pageToUpdate of pageToUpdateSet) {
    console.log("Now going to update links in", pageToUpdate);
    let { text } = await readPage(pageToUpdate);
    console.log("Received text", text);
    if (!text) {
      // Page likely does not exist, but at least we can skip it
      continue;
    }
    let newText = text.replaceAll(`[[${oldName}]]`, `[[${newName}]]`);
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
  let allBackLinks = await scanPrefixGlobal(`pl:${pageName}:`);
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

export async function showBackLinks() {
  const pageName = await getCurrentPage();
  let backLinks = await getBackLinks(pageName);

  console.log("Backlinks", backLinks);
}

export async function reindexCommand() {
  await flashNotification("Reindexing...");
  await invokeFunctionOnServer("reindexSpace");
  await flashNotification("Reindexing done");
}

// Completion
export async function pageComplete() {
  let prefix = await matchBefore("\\[\\[[\\w\\s]*");
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
    const pageObj = await readPage(name);
    await dispatch("page:index", {
      name,
      text: pageObj.text,
    });
  }
}

export async function clearPageIndex(page: string) {
  console.log("Clearing page index for page", page);
  await clearPageIndexForPage(page);
}

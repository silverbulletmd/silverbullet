import { IndexEvent } from "../../webapp/src/app_event";
import { pageLinkRegex } from "../../webapp/src/constant";
import { syscall } from "./lib/syscall";

const wikilinkRegex = new RegExp(pageLinkRegex, "g");

export async function indexLinks({ name, text }: IndexEvent) {
  let backLinks: { key: string; value: string }[] = [];
  for (let match of text.matchAll(wikilinkRegex)) {
    let toPage = match[1];
    let pos = match.index!;
    backLinks.push({
      key: `pl:${toPage}:${pos}`,
      value: name,
    });
  }
  console.log("Found", backLinks.length, "wiki link(s)");
  await syscall("indexer.batchSet", name, backLinks);
}

export async function deletePage() {
  let pageMeta = await syscall("editor.getCurrentPage");
  console.log("Navigating to start page");
  await syscall("editor.navigate", "start");
  console.log("Deleting page from space");
  await syscall("space.deletePage", pageMeta.name);
  console.log("Reloading page list");
  await syscall("space.reloadPageList");
}

export async function renamePage() {
  const pageMeta = await syscall("editor.getCurrentPage");
  const oldName = pageMeta.name;
  console.log("Old name is", oldName);
  const newName = await syscall(
    "editor.prompt",
    `Rename ${oldName} to:`,
    oldName
  );
  if (!newName) {
    return;
  }
  console.log("New name", newName);

  let pagesToUpdate = await getBackLinks(oldName);
  console.log("All pages containing backlinks", pagesToUpdate);

  let text = await syscall("editor.getText");
  console.log("Writing new page to space");
  await syscall("space.writePage", newName, text);
  console.log("Deleting page from space");
  await syscall("space.deletePage", oldName);
  console.log("Reloading page list");
  await syscall("space.reloadPageList");
  console.log("Navigating to new page");
  await syscall("editor.navigate", newName);

  let pageToUpdateSet = new Set<string>();
  for (let pageToUpdate of pagesToUpdate) {
    pageToUpdateSet.add(pageToUpdate.page);
  }

  for (let pageToUpdate of pageToUpdateSet) {
    console.log("Now going to update links in", pageToUpdate);
    let { text } = await syscall("space.readPage", pageToUpdate);
    if (!text) {
      // Page likely does not exist, but at least we can skip it
      continue;
    }
    let newText = text.replaceAll(`[[${oldName}]]`, `[[${newName}]]`);
    if (text !== newText) {
      console.log("Changes made, saving...");
      await syscall("space.writePage", pageToUpdate, newText);
    }
  }
}

type BackLink = {
  page: string;
  pos: number;
};

async function getBackLinks(pageName: string): Promise<BackLink[]> {
  let allBackLinks = await syscall(
    "indexer.scanPrefixGlobal",
    `pl:${pageName}:`
  );
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
  const pageMeta = await syscall("editor.getCurrentPage");
  let backLinks = await getBackLinks(pageMeta.name);

  console.log("Backlinks", backLinks);
}

export async function reindex() {
  await syscall("space.reindex");
}

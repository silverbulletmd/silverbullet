import type {
  CompleteEvent,
  IndexEvent,
  IndexTreeEvent,
  QueryProviderEvent,
} from "$sb/app_event.ts";
import {
  editor,
  index,
  markdown,
  space,
} from "$sb/silverbullet-syscall/mod.ts";

import { events } from "$sb/plugos-syscall/mod.ts";

import {
  addParentPointers,
  findNodeOfType,
  ParseTree,
  renderToText,
  replaceNodesMatching,
  traverseTree,
} from "$sb/lib/tree.ts";
import { applyQuery } from "$sb/lib/query.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";
import { isValidPageName } from "$sb/lib/page.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";

// Key space:
//   l:toPage:pos => {name: pageName, inDirective: true}
//   meta: => metaJson

const backlinkPrefix = `l:`;

export type BacklinkEntry = {
  name: string;
  alias?: string;
  inDirective?: boolean;
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
  // console.log("Found", backLinks.length, "wiki link(s)");
  await index.batchSet(name, backLinks);
}

export async function pageQueryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  return applyQuery(query, await space.listPages());
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
    links.push({ ...blEntry, pos });
  }
  return applyQuery(query, links);
}

export async function deletePage() {
  const pageName = await editor.getCurrentPage();
  if (
    !await editor.confirm(`Are you sure you would like to delete ${pageName}?`)
  ) {
    return;
  }
  console.log("Navigating to index page");
  await editor.navigate("");
  console.log("Deleting page from space");
  await space.deletePage(pageName);
}

export async function copyPage() {
  const oldName = await editor.getCurrentPage();
  const newName = await editor.prompt(`New page title:`, `${oldName} (copy)`);

  if (!newName) {
    return;
  }

  try {
    // This throws an error if the page does not exist, which we expect to be the case
    await space.getPageMeta(newName);
    // So when we get to this point, we error out
    throw new Error(
      `Page ${newName} already exists, cannot rename to existing page.`,
    );
  } catch (e: any) {
    if (e.message === "Not found") {
      // Expected not found error, so we can continue
    } else {
      await editor.flashNotification(e.message, "error");
      throw e;
    }
  }

  const text = await editor.getText();

  console.log("Writing new page to space");
  await space.writePage(newName, text);

  console.log("Navigating to new page");
  await editor.navigate(newName);
}

export async function renamePage(cmdDef: any) {
  console.log("Got a target name", cmdDef.page);
  const oldName = await editor.getCurrentPage();
  const cursor = await editor.getCursor();
  console.log("Old name is", oldName);
  const newName = cmdDef.page ||
    await editor.prompt(`Rename ${oldName} to:`, oldName);
  if (!newName) {
    return;
  }

  if (!isValidPageName(newName)) {
    return editor.flashNotification(
      "Invalid page name: page names cannot end with a file extension nor start with a '.'",
      "error",
    );
  }

  console.log("New name", newName);

  if (newName.trim() === oldName.trim()) {
    // Nothing to do here
    console.log("Name unchanged, exiting");
    return;
  }

  try {
    // This throws an error if the page does not exist, which we expect to be the case
    await space.getPageMeta(newName);
    // So when we get to this point, we error out
    throw new Error(
      `Page ${newName} already exists, cannot rename to existing page.`,
    );
  } catch (e: any) {
    if (e.message === "Not found") {
      // Expected not found error, so we can continue
    } else {
      await editor.flashNotification(e.message, "error");
      throw e;
    }
  }

  const pagesToUpdate = await getBackLinks(oldName);
  console.log("All pages containing backlinks", pagesToUpdate);

  const text = await editor.getText();

  console.log("Writing new page to space");
  const newPageMeta = await space.writePage(newName, text);
  console.log("Navigating to new page");
  await editor.navigate(newName, cursor, true);

  // Handling the edge case of a changing page name just in casing on a case insensitive FS
  const oldPageMeta = await space.getPageMeta(oldName);
  if (oldPageMeta.lastModified !== newPageMeta.lastModified) {
    // If they're the same, let's assume it's the same file (case insensitive FS) and not delete, otherwise...
    console.log("Deleting page from space");
    await space.deletePage(oldName);
  }

  const pageToUpdateSet = new Set<string>();
  for (const pageToUpdate of pagesToUpdate) {
    pageToUpdateSet.add(pageToUpdate.page);
  }

  let updatedReferences = 0;

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
    // The links in the page are going to be relative pointers to the old name
    replaceNodesMatching(mdTree, (n): ParseTree | undefined | null => {
      if (n.type === "WikiLinkPage") {
        const pageName = n.children![0].text!;
        if (pageName === oldName) {
          n.children![0].text = newName;
          updatedReferences++;
          return n;
        }
        // page name with @pos position
        if (pageName.startsWith(`${oldName}@`)) {
          const [, pos] = pageName.split("@");
          n.children![0].text = `${newName}@${pos}`;
          updatedReferences++;
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
  await editor.flashNotification(
    `Renamed page, and updated ${updatedReferences} references`,
  );
}

export async function newPageCommand() {
  const allPages = await space.listPages();
  let pageName = `Untitled`;
  let i = 1;
  while (allPages.find((p) => p.name === pageName)) {
    pageName = `Untitled ${i}`;
    i++;
  }
  await editor.navigate(pageName);
}

type BackLink = {
  page: string;
  pos: number;
};

async function getBackLinks(pageName: string): Promise<BackLink[]> {
  const allBackLinks = await index.queryPrefix(
    `${backlinkPrefix}${pageName}:`,
  );
  const pagesToUpdate: BackLink[] = [];
  for (const { key, value: { name } } of allBackLinks) {
    const keyParts = key.split(":");
    pagesToUpdate.push({
      page: name,
      pos: +keyParts[keyParts.length - 1],
    });
  }
  return pagesToUpdate;
}

export async function reindexCommand() {
  await editor.flashNotification("Reindexing...");
  await reindexSpace();
  await editor.flashNotification("Reindexing done");
}

// Completion
export async function pageComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  const allPages = await space.listPages();
  return {
    from: completeEvent.pos - match[1].length,
    options: allPages.map((pageMeta) => {
      return {
        label: pageMeta.name,
        boost: pageMeta.lastModified,
        type: "page",
      };
    }),
  };
}

export async function reindexSpace() {
  console.log("Clearing page index...");
  await index.clearPageIndex();
  // Executed this way to not have to embed the search plug code here
  await invokeFunction("client", "search.clearIndex");
  console.log("Listing all pages");
  const pages = await space.listPages();
  let counter = 0;
  for (const { name } of pages) {
    counter++;

    console.log(`Indexing page ${counter}/${pages.length}: ${name}`);
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
  // console.log("Clearing page index for page", page);
  await index.clearPageIndexForPage(page);
}

export async function parseIndexTextRepublish({ name, text }: IndexEvent) {
  // console.log("Reindexing", name);
  await events.dispatchEvent("page:index", {
    name,
    tree: await markdown.parseMarkdown(text),
  });
}

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
  system,
} from "$sb/silverbullet-syscall/mod.ts";

import { events } from "$sb/plugos-syscall/mod.ts";

import {
  addParentPointers,
  collectNodesMatching,
  ParseTree,
  renderToText,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";
import { applyQuery } from "$sb/lib/query.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";

// Key space:
//   pl:toPage:pos => pageName
//   meta => metaJson

export async function indexLinks({ name, tree }: IndexTreeEvent) {
  const backLinks: { key: string; value: string }[] = [];
  // [[Style Links]]
  // console.log("Now indexing", name);
  const pageMeta = extractFrontmatter(tree);
  if (Object.keys(pageMeta).length > 0) {
    // console.log("Extracted page meta data", pageMeta);
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
    const { value: name, key } of await index.queryPrefix(`pl:${pageName}:`)
  ) {
    const [, , pos] = key.split(":"); // Key: pl:page:pos
    links.push({ name, pos });
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
    if (e.message.includes("not found")) {
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
export async function pageComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@:]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  const allPages = await space.listPages();
  return {
    from: completeEvent.pos - match[1].length,
    options: allPages.map((pageMeta) => ({
      label: pageMeta.name,
      boost: pageMeta.lastModified,
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
  console.log("Reindexing", name);
  await events.dispatchEvent("page:index", {
    name,
    tree: await markdown.parseMarkdown(text),
  });
}

export async function findDeadLinks() {
  //https://github.com/gustf/js-levenshtein/blob/master/index.js
  function _min(r, e, t, n, o) { return r < e || t < e ? r > t ? t + 1 : r + 1 : n === o ? e : e + 1 } function levenshtein(r, e) { if (r === e) return 0; if (r.length > e.length) { var t = r; r = e, e = t } for (var n = r.length, o = e.length; n > 0 && r.charCodeAt(n - 1) === e.charCodeAt(o - 1);)n--, o--; for (var h = 0; h < n && r.charCodeAt(h) === e.charCodeAt(h);)h++; if (o -= h, 0 === (n -= h) || o < 3) return o; var a, c, f, i, d, A, C, u, l, m, v, _, g = 0, s = []; for (a = 0; a < n; a++)s.push(a + 1), s.push(r.charCodeAt(h + a)); for (var p = s.length - 1; g < o - 3;)for (l = e.charCodeAt(h + (c = g)), m = e.charCodeAt(h + (f = g + 1)), v = e.charCodeAt(h + (i = g + 2)), _ = e.charCodeAt(h + (d = g + 3)), A = g += 4, a = 0; a < p; a += 2)c = _min(C = s[a], c, f, l, u = s[a + 1]), f = _min(c, f, i, m, u), i = _min(f, i, d, v, u), A = _min(i, d, A, _, u), s[a] = A, d = i, i = f, f = c, c = C; for (; g < o;)for (l = e.charCodeAt(h + (c = g)), A = ++g, a = 0; a < p; a += 2)C = s[a], s[a] = A = _min(C, c, A, l, s[a + 1]), c = C; return A }
  let pages = await space.listPages()
  pages = pages.map(p => p.name)
  let content = await Promise.all(
    pages.map(p =>
      space.readPage(p).then(text => Array.from(text.matchAll(/\[\[([^\[\]\v]+)\]\]/gm), m => m[1]))
    )
  )
  let text = '{[Find Dead Links]}\n'
  console.log(content.flat(1))
  let unique = [...new Set(content.flat(1))]
  unique
    .filter(c => !pages.includes(c) && !['{{today}}', '{{tomorrow}}', '{{yesterday}}', '{{lastWeek}}', '{{nextWeek}}', '{{page}}'].includes(c))
    .forEach(link => {
      console.log(link)
      const distances = pages.map(p => levenshtein(p, link))
      //https://devblogs.microsoft.com/oldnewthing/20140526-00/?p=903
      console.log(`[[${link}]]`)
      console.log(`Possible duplicate of [[${pages[distances.indexOf(Math.min.apply(Math, distances))]}]]`)
      text += `### [[${link}]]
Possible duplicate of [[${pages[distances.indexOf(Math.min.apply(Math, distances))]}]]
`
      console.log(link, pages[distances.indexOf(Math.min.apply(Math, distances))], distances.indexOf(Math.min.apply(Math, distances)))

    });
  await space.writePage(`☠️🔗 Dead Links`, text)
  await editor.navigate(`☠️🔗 Dead Links`)
}

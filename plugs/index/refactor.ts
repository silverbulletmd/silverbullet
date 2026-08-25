import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import {
  getNameFromPath,
  isValidPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { folderName } from "@silverbulletmd/silverbullet/lib/resolve";
import {
  BasenameIndex,
  type LinkWriteFormat,
  writeLinkPath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  config,
  editor,
  index,
  lua,
  markdown,
  mq,
  space,
} from "@silverbulletmd/silverbullet/syscalls";
import { findRenameConflict, shouldDeleteOldPath } from "./refactor_case.ts";
import { spliceReference } from "./refactor_splice.ts";
import { getTextualBackRelations, type RelationObject } from "./relation.ts";

/** A relation known to span page text, which is what a rewrite needs. */
type RangedRelation = RelationObject & { range: [number, number] };

/**
 * Renames a single page.
 * @param cmdDef Optional command arguments
 * @param cmdDef.oldPage The current name of the page to rename. Defaults to
 *   the current page selected in the editor.
 * @param cmdDef.page The name to rename the page to. If not provided the
 *   user will be prompted to enter a new name.
 * @returns True if the rename succeeded; otherwise, false.
 */
export async function renamePageCommand(cmdDef: any) {
  const oldName: string = cmdDef.oldPage || (await editor.getCurrentPage());
  let newName: string =
    cmdDef.page || (await editor.prompt(`Rename ${oldName} to:`, oldName));
  if (newName === undefined) {
    return false;
  }
  newName = newName.trim();
  if (newName === "") {
    void editor.flashNotification(
      "Must provide a non-empty page title.",
      "error",
    );
    return false;
  }
  const pageList: [string, string][] = [[`${oldName}.md`, `${newName}.md`]];
  await batchRenameFiles(pageList);
  return true;
}

export async function renamePageLinkCommand() {
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  const link = nodeAtPos(mdTree, await editor.getCursor());
  if (!link) {
    console.error("No link found at cursor position...");
    return;
  }
  addParentPointers(mdTree);
  let node: ParseTree | null = link;
  if (node.type !== "WikiLink") {
    node = findParentMatching(node, (t) => t.type === "WikiLink");
    if (!node) {
      console.error("No link found at cursor position");
      return;
    }
  }
  const wikiLinkPage = findNodeOfType(node, "WikiLinkPage");
  if (!wikiLinkPage) {
    console.error("No link found at cursor position");
    return;
  }
  const oldName = wikiLinkPage.children![0].text!;

  let newName = await editor.prompt(`Rename ${oldName} to:`, oldName);
  if (newName === undefined) {
    return false;
  }
  newName = newName.trim();
  if (newName === "") {
    void editor.flashNotification(
      "Must provide a non-empty page title.",
      "error",
    );
    return false;
  }
  const pageList: [string, string][] = [[`${oldName}.md`, `${newName}.md`]];
  await batchRenameFiles(pageList);
}

/**
 * Renames a single document.
 * @param cmdDef Optional command arguments
 * @param cmdDef.oldDocument The current name of the document to rename.
 * @param cmdDef.document The name to rename the document to. If not provided the
 *   user will be prompted to enter a new name.
 * @returns True if the rename succeeded; otherwise, false.
 */
export async function renameDocumentCommand(cmdDef: any) {
  const oldName: string = cmdDef.oldDocument || (await editor.getCurrentPath());
  let newName: string =
    cmdDef.document || (await editor.prompt(`Rename ${oldName} to:`, oldName));
  if (newName === undefined) {
    return false;
  }
  newName = newName.trim();
  if (newName === "") {
    void editor.flashNotification(
      "Must provide a non-empty document name.",
      "error",
    );
    return false;
  }
  const pageList: [string, string][] = [[oldName, newName]];
  await batchRenameFiles(pageList);
  return true;
}

/**
 * Renames any amount of files.
 * If renaming pages, names should be passed with a .md extension
 * @param fileList An array of tuples containing [FileToBeRenamed, NewFileName]
 * @returns True if the rename succeeded; otherwise, false.
 */
export async function batchRenameFiles(fileList: [string, string][]) {
  await editor.save();

  // Skip unchanged names
  fileList = fileList.filter(([oldName, newName]) => {
    if (oldName.trim() === newName.trim()) {
      console.log(`${oldName}'s name unchanged, skipping`);
    } else {
      return [oldName, newName];
    }
  });

  try {
    // Compares against the file list rather than probing with getFileMeta: on
    // a case-insensitive filesystem a probe for `oldname.md` resolves the
    // existing `OldName.md`, which made every case-only rename impossible.
    const existingPaths = [
      ...(await space.listDocuments()).map((doc) => doc.name),
      ...(await space.listPages()).map((page) => `${page.name}.md`),
    ];

    for (const [oldName, newName] of fileList) {
      // It's a FILEname not a PAGEname.
      if (!isValidPath(newName)) {
        throw new Error(`Name invalid: ${newName}`);
      }
      const conflict = findRenameConflict(existingPaths, oldName, newName);
      if (conflict === newName) {
        throw new Error(
          `${newName} already exists, cannot rename to existing file.`,
        );
      } else if (conflict !== undefined) {
        throw new Error(
          `${newName} differs only in casing from ${conflict}, cannot rename.`,
        );
      }
    }

    // All new names are available, proceeding with rename
    for (const [oldName, newName] of fileList) {
      console.log("Renaming", oldName, "to", newName);
      try {
        if (newName.endsWith(".md") && oldName.endsWith(".md")) {
          await renamePage(oldName.slice(0, -3), newName.slice(0, -3));
        } else {
          await renameDocument(oldName, newName);
        }
      } catch (e: any) {
        if (e.message === notFoundError.message) {
          console.log(`${oldName} does not exist, skipping`);
        } else {
          throw e;
        }
      }
    }

    return true;
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
    return false;
  }
}

/**
 * Whether `path` exists under exactly this casing. `getFileMeta` can't answer
 * that — on a case-insensitive filesystem it resolves a differently-cased file
 * happily — but the file list reports real on-disk names.
 */
async function existsWithExactCasing(path: string): Promise<boolean> {
  if (path.endsWith(".md")) {
    const name = path.slice(0, -3);
    return (await space.listPages()).some((page) => page.name === name);
  }
  return (await space.listDocuments()).some((doc) => doc.name === path);
}

// Rename a page, update any backlinks and linked documents
async function renamePage(oldName: string, newName: string) {
  let text = await space.readPage(oldName);

  // Update relative links and documents on this page
  const oldFolder = folderName(oldName);
  const newFolder = folderName(newName);
  const documentsToMove = new Set<string>();
  // Links only need to be updated if the folder changes
  if (oldFolder !== newFolder) {
    // Pull every relation on this page that points at a page or file —
    // these are the candidates whose relative-path form may need to be
    // rewritten when the page moves between folders. A `recipient:` target
    // is never one: its range covers literal `@nickname` text rather than
    // link syntax, or it has no range at all (a `recipients:` frontmatter
    // nickname), so those are excluded up front.
    const relsInPage = await index.queryLuaObjects<RangedRelation>(
      "relation",
      {
        objectVariable: "_",
        where: await lua.parseExpression(
          `_.page == oldName and _.kind ~= "co-mention" and _.toTag ~= "recipient" and _.toTag ~= "url" and _.range ~= nil`,
        ),
      },
      { oldName },
    );

    const linksToUpdate: RangedRelation[] = [];
    for (const rel of relsInPage) {
      if (rel.toTag === "document" && folderName(rel.to) === oldFolder) {
        const backRels = await getTextualBackRelations(rel.to);
        if (backRels.filter((a) => a.page !== oldName).length === 0) {
          // Document is in the same folder as the page and is only
          // linked from this page — move it along with the page.
          documentsToMove.add(rel.to);
          continue;
        }
      }
      linksToUpdate.push(rel);
    }

    // Sort backwards by position so earlier splices don't shift later ones.
    linksToUpdate.sort((a, b) => b.range[0] - a.range[0]);

    for (const rel of linksToUpdate) {
      const pos = rel.range[0];
      // Only markdown-link forms `[text](path)` have a relative path to
      // rewrite. Wikilinks (`[[...]]`) reference targets by absolute
      // name and need no path rewrite when the source page moves.
      if (text.substring(pos, pos + 2) === "[[") continue;

      text = spliceReference({
        text,
        range: rel.range,
        oldName: rel.to,
        newName: rel.to,
        pageToEdit: newName,
      });
    }
  }

  // Write the new page
  await space.writePage(newName, text);

  // Move documents along with page
  const batchRenameDocuments: [string, string][] = [];
  for (const document of documentsToMove) {
    const newAttName =
      oldFolder.length === 0
        ? `${newFolder}/${document}`
        : document.replace(oldFolder, newFolder).replace(/^\//, "");
    batchRenameDocuments.push([document, newAttName]);
  }
  if (batchRenameDocuments.length > 0) {
    await batchRenameFiles(batchRenameDocuments);
  }

  // A server-side re-case can fail (a Windows sharing violation, a symlinked
  // folder), leaving the file under its old name — where deleting that name
  // would destroy the only copy. Only check for case-only renames: the check
  // itself is a full uncached `GET /.fs` plus an event storm.
  const oldPath = `${oldName}.md`;
  const newPath = `${newName}.md`;
  const existsExact =
    oldPath.toLowerCase() === newPath.toLowerCase()
      ? await existsWithExactCasing(newPath)
      : false;
  if (shouldDeleteOldPath(oldPath, newPath, existsExact)) {
    await space.deletePage(oldName);
  }

  // Update backlinks to this page
  const { updated: updatedRefences } = await updateBacklinks(oldName, newName);

  // Navigate to new page if currently viewing old page
  if ((await editor.getCurrentPage()) === oldName) {
    // Wait for index queue to be processed so that widgets are updated with up-to-date information
    await mq.awaitEmptyQueue("indexQueue");
    await editor.navigate(newName, true);
  }

  let message = `Renamed ${oldName} to ${newName}`;
  if (updatedRefences > 0) {
    message = `${message}, updated ${updatedRefences} backlinks`;
  }
  if (documentsToMove.size > 0) {
    message = `${message}, moved ${documentsToMove.size} documents`;
  }
  await editor.flashNotification(message, "info");
}

// Rename a document and update any backlinks
async function renameDocument(oldPath: string, newPath: string) {
  // Move the file
  const oldFile = await space.readDocument(oldPath);
  await space.writeDocument(newPath, oldFile);

  if ((await editor.getCurrentPath()) === oldPath) {
    await editor.navigate(newPath, true);
  }

  // Same guard as renamePage, above.
  const existsExact =
    oldPath.toLowerCase() === newPath.toLowerCase()
      ? await existsWithExactCasing(newPath)
      : false;
  if (shouldDeleteOldPath(oldPath, newPath, existsExact)) {
    await space.deleteDocument(oldPath);
  }

  // Update any backlinks
  const { updated: updatedRefences } = await updateBacklinks(oldPath, newPath);
  let message = `Renamed ${oldPath} to ${newPath}`;
  if (updatedRefences > 0) {
    message = `${message}, updated ${updatedRefences} backlinks`;
  }
  await editor.flashNotification(message, "info");
}

/**
 * Renames pages based on a prefix string.
 * @param cmdDef Optional command arguments
 * @param cmdDef.oldPrefix The prefix to rename from. If not provided the
 *   user will be prompted to enter a prefix.
 * @param cmdDef.newPrefix The prefix with which to replace the `oldPrefix`
 *   value. If not provided the user will be prompted to enter a new prefix.
 * @param cmdDef.disableConfirmation If false, the user will be prompted
 *   to confirm the rename action; Otherwise no confirmation dialog will
 *   be shown before renaming. Defaults to false.
 * @returns True if the rename succeeded; otherwise, false.
 */
export async function renamePrefixCommand(cmdDef: any) {
  const oldPrefix =
    cmdDef.oldPrefix ?? (await editor.prompt("Prefix to rename:", ""));
  if (oldPrefix === undefined) {
    return false;
  }
  // Note, we do *not* trim the old or new prefix input as the user may
  // actually want to add or remove white space. They can also input an empty
  // string for the new prefix to remove the old prefix.
  if (oldPrefix === "") {
    void editor.flashNotification("Must provide a non-empty prefix.", "error");
    return false;
  }
  const newPrefix =
    cmdDef.newPrefix ?? (await editor.prompt("New prefix:", oldPrefix));
  if (newPrefix === undefined) {
    return false;
  }

  const allDocuments = await space.listDocuments();
  const allPages = await space.listPages();
  let allAffectedFiles = allDocuments
    .map((file) => file.name)
    .filter((file) => file.startsWith(oldPrefix));
  allAffectedFiles = allAffectedFiles.concat(
    allPages
      .map((page) => `${page.name}.md`)
      .filter((page) => page.startsWith(oldPrefix)),
  );

  if (
    cmdDef.disableConfirmation !== true &&
    !(await editor.confirm(
      `This will affect ${allAffectedFiles.length} files. Are you sure?`,
      { destructive: true },
    ))
  ) {
    return false;
  }

  const allNewNames: [string, string][] = allAffectedFiles.map(
    (
      name, // This may seem naive, but it's actually fine, because we're only renaming the first occurrence (which will be the prefix)
    ) => [name, name.replace(oldPrefix, newPrefix)],
  );
  await batchRenameFiles(allNewNames);
}

export async function extractToPageCommand() {
  const selection = await editor.getSelection();
  let text = await editor.getText();
  text = text.slice(selection.from, selection.to);

  const match = text.match("#{1,6}\\s+([^\n]*)");

  let newName;
  if (match) {
    newName = match[1];
  } else {
    newName = "new page";
  }
  newName = await editor.prompt(`New page title:`, newName);
  if (newName === undefined) {
    return false;
  }
  newName = newName.trim();
  if (newName === "") {
    void editor.flashNotification(
      "Must provide a non-empty page title.",
      "error",
    );
  }

  try {
    // This throws an error if the page does not exist, which we expect to be the case
    await space.getPageMeta(newName);
    // So when we get to this point, we error out
    throw new Error(
      `Page ${newName} already exists, cannot rename to existing page.`,
    );
  } catch (e: any) {
    if (e.message === notFoundError.message) {
      // Expected not found error, so we can continue
    } else {
      await editor.flashNotification(e.message, "error");
      throw e;
    }
  }
  await editor.replaceRange(selection.from, selection.to, `[[${newName}]]`);
  console.log("Writing new page to space");
  await space.writePage(newName, text);
  console.log("Navigating to new page");
  await editor.navigate(newName);
}

/**
 * Updates backlinks across all pages
 * @param oldName Full path to old page/file
 * @param newName Full path to new page/file
 * @returns The number of references updated
 */
async function wikiLinkTextFor(
  name: string,
  vanishingName?: string,
): Promise<string> {
  const path = parseToRef(name)?.path;
  if (!path) {
    return name;
  }
  const writeFormat = await config.get<LinkWriteFormat>(
    "linkWriteFormat",
    "shortest",
  );

  const lookups = await space.lookupPaths([path]);
  const index = new BasenameIndex();
  index.rebuild([...(lookups[path]?.candidates ?? []), path]);

  const vanishingPath = vanishingName
    ? parseToRef(vanishingName)?.path
    : undefined;
  if (vanishingPath) {
    index.delete(vanishingPath);
  }

  return getNameFromPath(writeLinkPath(path, writeFormat, index));
}

export async function updateBacklinks(
  oldName: string,
  newName: string,
  wikiNameOverride?: string,
  wikiLinksOnly = false,
): Promise<{ updated: number }> {
  // This is the bit where we update all the links
  const backRelations = await getTextualBackRelations(oldName);
  const newWikiName =
    wikiNameOverride ?? (await wikiLinkTextFor(newName, oldName));
  let updatedReferences = 0;

  // Group by page to edit entire page at once
  const byPage = backRelations.reduce(
    (group: Record<string, RelationObject[]>, rec) => {
      const { page } = rec;
      group[page] = group[page] ?? [];
      group[page].push(rec);
      return group;
    },
    {},
  );

  console.log("All pages containing backlinks", backRelations);
  for (const [pageToEdit, recsInPage] of Object.entries(byPage)) {
    if (pageToEdit === oldName) {
      continue;
    }

    const original = await space.readPage(pageToEdit);
    if (!original) {
      // Page likely does not exist, but at least we can skip it
      continue;
    }
    let text = original;

    // Apply in descending range order so earlier splices don't shift
    // later positions.
    recsInPage.sort((a, b) => (b.range?.[0] ?? 0) - (a.range?.[0] ?? 0));

    for (const rec of recsInPage) {
      if (!rec.range) continue;
      if (wikiLinksOnly) {
        const slice = text.substring(rec.range[0], rec.range[1]);
        if (!slice.startsWith("[[") && !slice.startsWith("![[")) continue;
      }
      const before = text;
      text = spliceReference({
        text,
        range: rec.range,
        oldName,
        newName,
        newWikiName,
        pageToEdit,
      });
      if (text !== before) updatedReferences++;
    }
    // Nothing changed (every splice was a no-op): don't churn the file's
    // mtime with a byte-identical write.
    if (text !== original) {
      await space.writePage(pageToEdit, text);
    }
  }

  return { updated: updatedReferences };
}

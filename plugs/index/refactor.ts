import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import { race, sleep } from "@silverbulletmd/silverbullet/lib/async";
import {
  linkWriteFormat,
  writtenLinkText,
} from "@silverbulletmd/silverbullet/lib/link_write";
import {
  isValidPath,
  type Path,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { fileName, folderName } from "@silverbulletmd/silverbullet/lib/resolve";
import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  editor,
  events,
  index,
  lua,
  markdown,
  mq,
  space,
} from "@silverbulletmd/silverbullet/syscalls";
import { findRenameConflict, shouldDeleteOldPath } from "./refactor_case.ts";
import { spliceReference } from "./refactor_splice.ts";
import { applySplices, type Splice, yamlRegions } from "./refactor_yaml.ts";
import {
  getTextualBackRelations,
  getTextualBackRelationsToAny,
  isWikiLinkAt,
  type RelationObject,
} from "./relation.ts";
import { requalifyCollisions } from "./requalify.ts";

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

/** How long a rename waits for the index to catch up before going ahead. */
const indexCatchUpTimeoutMs = 10_000;

function isPagePath(path: string): boolean {
  return path.endsWith(".md");
}

function pageNameOf(path: string): string {
  return path.slice(0, -3);
}

/** Old page names of the batch running now, and the names they move to. */
const pagesLeaving = new Set<string>();
const pagesArriving = new Set<string>();

/**
 * Whether `pageName` is a page a rename is moving away from right now. While
 * both copies exist that is not a name collision to requalify.
 */
export function isLeavingByRename(pageName: string): boolean {
  return pagesLeaving.has(pageName);
}

/**
 * Whether `pageName` is being written by a rename right now. Requalifying it
 * then would race the rename's own link rewrites, so the rename requalifies
 * every page it wrote once it is done.
 */
export function isArrivingByRename(pageName: string): boolean {
  return pagesArriving.has(pageName);
}

/** What a rename writes for one file: its new path and the relations to splice. */
type RenamePlan = {
  /** Old path → new path, in the order the files are moved. */
  renames: Map<string, string>;
  /** Page holding the relations → those relations (ranges in its current text). */
  relationsByPage: Map<string, RangedRelation[]>;
  /** Renamed target → the link text a wiki link to it gets. */
  wikiNames: Map<string, string>;
};

/**
 * Renames any amount of files, updating every link to and inside them.
 * Page paths carry their `.md` extension.
 *
 * The whole batch is planned from one index snapshot before any file is
 * touched: writing a page only queues it for reindexing while deleting one
 * clears it at once, so asking the index between renames misses the links of
 * pages renamed earlier in the same batch.
 * @param fileList An array of tuples containing [FileToBeRenamed, NewFileName]
 * @returns True if every file was renamed; otherwise, false.
 */
export async function batchRenameFiles(
  fileList: [string, string][],
): Promise<boolean> {
  await editor.save();

  fileList = fileList.filter(([oldName, newName]) => {
    if (oldName.trim() === newName.trim()) {
      console.log(`${oldName}'s name unchanged, skipping`);
      return false;
    }
    return true;
  });
  if (fileList.length === 0) {
    return true;
  }

  let existingPaths: string[];
  try {
    // Compares against the file list rather than probing with getFileMeta: on
    // a case-insensitive filesystem a probe for `oldname.md` resolves the
    // existing `OldName.md`, which made every case-only rename impossible.
    existingPaths = [
      ...(await space.listDocuments()).map((doc) => doc.name),
      ...(await space.listPages()).map((page) => `${page.name}.md`),
    ];
    // Backlinks come from the index. Listing just queued any files changed
    // outside the editor (a sync, a git pull) for reindexing; until that is
    // done the index still holds their old links, and the rename would skip
    // them silently.
    if (!(await awaitIndexCatchUp())) {
      await editor.flashNotification(
        "Indexing is still catching up: links in recently changed pages may not be updated",
        "error",
      );
    }

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
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
    return false;
  }

  const existing = new Set(existingPaths);
  fileList = fileList.filter(([oldName]) => {
    if (existing.has(oldName)) return true;
    console.log(`${oldName} does not exist, skipping`);
    return false;
  });
  if (fileList.length === 0) {
    return true;
  }

  const plan = await planRenames(fileList, existing);
  const currentPage = await editor.getCurrentPage();
  const currentPath = await editor.getCurrentPath();
  const result = await executeRenamePlan(plan);

  if (result.renamed.length > 0) {
    // Listeners (the space tree's saved order, say) follow these file paths.
    await events.dispatchEvent("file:renamed", result.renamed);
  }

  const indexCaughtUp = await awaitIndexCatchUp();
  for (const { to } of result.renamed) {
    if (isPagePath(to) && indexCaughtUp) {
      await requalifyCollisions(pageNameOf(to));
    }
  }

  const movedCurrent = result.renamed.find(
    ({ from }) =>
      from === currentPath ||
      (isPagePath(from) && pageNameOf(from) === currentPage),
  );
  if (movedCurrent) {
    await editor.navigate(
      isPagePath(movedCurrent.to)
        ? pageNameOf(movedCurrent.to)
        : movedCurrent.to,
      true,
    );
  }

  await reportRenames(plan, result);
  return result.failures.length === 0;
}

/** Waits for the index queue to drain, for at most `indexCatchUpTimeoutMs`. */
function awaitIndexCatchUp(): Promise<boolean> {
  return race([
    mq.awaitEmptyQueue("indexQueue").then(() => true),
    sleep(indexCatchUpTimeoutMs).then(() => false),
  ]);
}

/** Collects every file a batch moves and every relation it rewrites. */
async function planRenames(
  fileList: [string, string][],
  existing: Set<string>,
): Promise<RenamePlan> {
  const renames = new Map<string, string>(fileList);

  // Pages whose folder changes: their relative links need recomputing, and
  // documents only they link to move along with them.
  const folderMovers = new Map<string, string>();
  for (const [oldPath, newPath] of fileList) {
    if (
      isPagePath(oldPath) &&
      isPagePath(newPath) &&
      folderName(oldPath) !== folderName(newPath)
    ) {
      folderMovers.set(pageNameOf(oldPath), pageNameOf(newPath));
    }
  }

  const movers: Record<string, true> = {};
  for (const name of folderMovers.keys()) movers[name] = true;
  const ownRelations =
    folderMovers.size === 0
      ? []
      : await index.queryLuaObjects<RangedRelation>(
          "relation",
          {
            objectVariable: "_",
            where: await lua.parseExpression(
              `movers[_.page] and _.toTag == "document" and _.range ~= nil`,
            ),
          },
          { movers },
        );
  const documentCandidates = new Map<string, string>();
  for (const rel of ownRelations) {
    const oldFolder = folderName(rel.page);
    if (
      folderName(rel.to) !== oldFolder ||
      renames.has(rel.to) ||
      !existing.has(rel.to)
    ) {
      continue;
    }
    const newFolder = folderName(folderMovers.get(rel.page)!);
    documentCandidates.set(
      rel.to,
      oldFolder.length === 0
        ? `${newFolder}/${rel.to}`
        : `${newFolder}${rel.to.slice(oldFolder.length)}`.replace(/^\//, ""),
    );
  }
  if (documentCandidates.size > 0) {
    const linkingPages = new Map<string, Set<string>>();
    for (const rel of await getTextualBackRelationsToAny(
      documentCandidates.keys(),
    )) {
      if (!linkingPages.has(rel.to)) linkingPages.set(rel.to, new Set());
      linkingPages.get(rel.to)!.add(rel.page);
    }
    for (const [document, newDocument] of documentCandidates) {
      const pages = linkingPages.get(document);
      if (pages?.size === 1 && !existing.has(newDocument)) {
        renames.set(document, newDocument);
      }
    }
  }

  const targets: Record<string, true> = {};
  for (const oldPath of renames.keys()) {
    targets[isPagePath(oldPath) ? pageNameOf(oldPath) : oldPath] = true;
  }
  // at-mentions are excluded: their range covers literal `@nickname` text,
  // which the rename never rewrites.
  const relations = await index.queryLuaObjects<RangedRelation>(
    "relation",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        `(targets[_.to] or movers[_.page]) and _.range ~= nil and _.kind ~= "co-mention" and _.kind ~= "at-mention" and _.toTag ~= "url" and _.toTag ~= "identity"`,
      ),
    },
    { targets, movers },
  );
  const relationsByPage = new Map<string, RangedRelation[]>();
  for (const rel of relations) {
    const isTarget = renamedTarget(renames, rel.to) !== undefined;
    if (!isTarget && !folderMovers.has(rel.page)) continue;
    if (!relationsByPage.has(rel.page)) relationsByPage.set(rel.page, []);
    relationsByPage.get(rel.page)!.push(rel);
  }

  return {
    renames,
    relationsByPage,
    wikiNames: await plannedWikiNames(renames),
  };
}

/** The name a relation target `to` (a page name or document path) moves to. */
function renamedTarget(
  renames: Map<string, string>,
  to: string,
): string | undefined {
  const asPage = renames.get(`${to}.md`);
  if (asPage !== undefined) {
    return isPagePath(asPage) ? pageNameOf(asPage) : asPage;
  }
  return renames.get(to);
}

/**
 * The link text a wiki link to each renamed file gets, worked out against the
 * space as it will be once the whole batch is done.
 */
async function plannedWikiNames(
  renames: Map<string, string>,
): Promise<Map<string, string>> {
  const writeFormat = await linkWriteFormat();
  const newPaths = [...renames.values()];
  const lookups = await space.lookupPaths(newPaths);
  const wikiNames = new Map<string, string>();
  for (const [oldPath, newPath] of renames) {
    const basenames = new BasenameIndex();
    basenames.rebuild([
      ...(lookups[newPath]?.candidates ?? []),
      ...newPaths.filter((path) => fileName(path) === fileName(newPath)),
    ]);
    for (const leaving of renames.keys()) {
      basenames.delete(leaving);
    }
    basenames.add(newPath);
    wikiNames.set(
      oldPath,
      writtenLinkText(newPath as Path, writeFormat, basenames),
    );
  }
  return wikiNames;
}

type RenameResult = {
  renamed: { from: string; to: string }[];
  failures: { path: string; error: string }[];
  linksUpdated: number;
  pagesUpdated: number;
};

/** Moves each file and rewrites each linking page once, collecting failures. */
async function executeRenamePlan(plan: RenamePlan): Promise<RenameResult> {
  const { renames, relationsByPage } = plan;
  const result: RenameResult = {
    renamed: [],
    failures: [],
    linksUpdated: 0,
    pagesUpdated: 0,
  };
  const linkingPages = [...relationsByPage.keys()].filter(
    (page) => !renames.has(`${page}.md`),
  );
  const total = renames.size + linkingPages.length;
  const showProgress = renames.size > 1;
  let done = 0;
  const step = async () => {
    done++;
    if (showProgress) {
      await showRenameProgress(Math.round((done / total) * 100));
    }
  };

  for (const [oldPath, newPath] of renames) {
    if (isPagePath(oldPath) && isPagePath(newPath)) {
      pagesLeaving.add(pageNameOf(oldPath));
      pagesArriving.add(pageNameOf(newPath));
    }
  }
  try {
    for (const [oldPath, newPath] of renames) {
      try {
        if (isPagePath(oldPath) && isPagePath(newPath)) {
          const oldName = pageNameOf(oldPath);
          const newName = pageNameOf(newPath);
          const text = await rewrittenText(plan, oldName, newName, result);
          await space.writePage(newName, text);
        } else {
          await space.writeDocument(newPath, await space.readDocument(oldPath));
        }
      } catch (e: any) {
        result.failures.push({ path: oldPath, error: e.message });
        await step();
        continue;
      }
      try {
        await deleteRenamedFrom(oldPath, newPath);
        result.renamed.push({ from: oldPath, to: newPath });
      } catch (e: any) {
        result.failures.push({
          path: oldPath,
          error: `copied to ${newPath}, but the original could not be removed: ${e.message}`,
        });
      }
      await step();
    }

    for (const page of linkingPages) {
      try {
        const original = await space.readPage(page);
        const text = await rewrittenText(plan, page, page, result, original);
        // Nothing changed (every splice was a no-op): don't churn the file's
        // mtime with a byte-identical write.
        if (text !== original) {
          await space.writePage(page, text);
        }
      } catch (e: any) {
        result.failures.push({
          path: `${page}.md`,
          error: `links not updated: ${e.message}`,
        });
      }
      await step();
    }
  } finally {
    pagesLeaving.clear();
    pagesArriving.clear();
    if (showProgress) {
      await showRenameProgress(undefined);
    }
  }
  return result;
}

/** The indicator is cosmetic: a host without it must not fail a rename. */
async function showRenameProgress(percentage: number | undefined) {
  try {
    if (percentage === undefined) {
      await editor.hideProgress("rename");
    } else {
      await editor.showProgress("rename", percentage);
    }
  } catch (e: any) {
    console.warn("Could not show rename progress", e.message);
  }
}

/**
 * `page`'s text with every planned relation in it spliced, as it should read
 * under its final name `finalName`.
 */
async function rewrittenText(
  plan: RenamePlan,
  page: string,
  finalName: string,
  result: RenameResult,
  text?: string,
): Promise<string> {
  text ??= await space.readPage(page);
  const relations = plan.relationsByPage.get(page) ?? [];
  const splices: Splice[] = [];
  for (const rel of relations) {
    const target = renamedTarget(plan.renames, rel.to);
    // Wiki links are absolute, so only a renamed target changes them; a
    // relative Markdown link also changes when the page holding it moves.
    if (target === undefined && isWikiLinkAt(text, rel.range)) continue;
    const oldTargetPath = plan.renames.has(`${rel.to}.md`)
      ? `${rel.to}.md`
      : rel.to;
    splices.push({
      range: rel.range,
      apply: (text) =>
        spliceReference({
          text,
          range: rel.range,
          oldName: rel.to,
          newName: target ?? rel.to,
          newWikiName:
            target === undefined
              ? undefined
              : plan.wikiNames.get(oldTargetPath),
          pageToEdit: finalName,
        }),
    });
  }
  if (splices.length === 0) {
    return text;
  }
  const regions = yamlRegions(await markdown.parseMarkdown(text));
  const applied = applySplices(text, splices, regions);
  if (applied.changed > 0) {
    result.linksUpdated += applied.changed;
    result.pagesUpdated++;
  }
  return applied.text;
}

/** Removes the file a rename copied from, unless it is the copy itself. */
async function deleteRenamedFrom(oldPath: string, newPath: string) {
  // A server-side re-case can fail (a Windows sharing violation, a symlinked
  // folder), leaving the file under its old name — where deleting that name
  // would destroy the only copy. Only check for case-only renames: the check
  // itself is a full uncached `GET /.fs` plus an event storm.
  const existsExact =
    oldPath.toLowerCase() === newPath.toLowerCase()
      ? await existsWithExactCasing(newPath)
      : false;
  if (!shouldDeleteOldPath(oldPath, newPath, existsExact)) {
    return;
  }
  if (isPagePath(oldPath)) {
    await space.deletePage(pageNameOf(oldPath));
  } else {
    await space.deleteDocument(oldPath);
  }
}

/** One notification for the batch, plus one listing whatever failed. */
async function reportRenames(plan: RenamePlan, result: RenameResult) {
  const display = (path: string) =>
    isPagePath(path) ? pageNameOf(path) : path;
  if (result.renamed.length === 1 && plan.renames.size === 1) {
    const [{ from, to }] = result.renamed;
    let message = `Renamed ${display(from)} to ${display(to)}`;
    if (result.linksUpdated > 0) {
      message = `${message}, updated ${result.linksUpdated} backlinks`;
    }
    await editor.flashNotification(message, "info");
  } else if (result.renamed.length > 0) {
    let message = `Moved ${result.renamed.length} files`;
    if (result.linksUpdated > 0) {
      message = `${message}, updated ${result.linksUpdated} links in ${result.pagesUpdated} pages`;
    }
    await editor.flashNotification(message, "info");
  }
  if (result.failures.length > 0) {
    const shown = result.failures
      .slice(0, 5)
      .map(({ path, error }) => `${display(path)}: ${error}`);
    if (result.failures.length > shown.length) {
      shown.push(`and ${result.failures.length - shown.length} more`);
    }
    console.error("Rename failures", result.failures);
    await editor.flashNotification(
      `Could not rename ${result.failures.length} files. ${shown.join("; ")}`,
      "error",
    );
  }
}

/**
 * Whether `path` exists under exactly this casing. `getFileMeta` can't answer
 * that — on a case-insensitive filesystem it resolves a differently-cased file
 * happily — but the file list reports real on-disk names.
 */
async function existsWithExactCasing(path: string): Promise<boolean> {
  if (isPagePath(path)) {
    const name = pageNameOf(path);
    return (await space.listPages()).some((page) => page.name === name);
  }
  return (await space.listDocuments()).some((doc) => doc.name === path);
}

/** Every page and document whose path starts with `prefix`, renamed to start
 * with `newPrefix` instead. */
async function filesUnderPrefix(
  prefix: string,
  newPrefix: string,
): Promise<[string, string][]> {
  const paths = [
    ...(await space.listPages()).map((page) => `${page.name}.md`),
    ...(await space.listDocuments()).map((doc) => doc.name),
  ];
  return paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => [path, newPrefix + path.slice(prefix.length)]);
}

/** Asks once before a batch, naming what moves where. */
function confirmBatch(
  summary: string,
  fileList: [string, string][],
): Promise<boolean> {
  const pages = fileList.filter(([path]) => isPagePath(path)).length;
  const documents = fileList.length - pages;
  const counts = [
    pages > 0 ? `${pages} ${pages === 1 ? "page" : "pages"}` : "",
    documents > 0
      ? `${documents} ${documents === 1 ? "document" : "documents"}`
      : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return editor.confirm(
    `${summary} This moves ${counts || "no files"} and updates links to them.`,
    { destructive: true },
  );
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

  const fileList = await filesUnderPrefix(oldPrefix, newPrefix);
  if (
    cmdDef.disableConfirmation !== true &&
    !(await confirmBatch(
      `Rename prefix "${oldPrefix}" to "${newPrefix}"?`,
      fileList,
    ))
  ) {
    return false;
  }
  return await batchRenameFiles(fileList);
}

/**
 * Moves a folder, and the page of the same name when there is one, as one
 * batch after a single confirmation.
 * @param cmdDef.oldName The folder to move.
 * @param cmdDef.newName Where to move it.
 * @param cmdDef.withPage Whether the page named like the folder moves too.
 * @returns True if every file was moved; otherwise, false.
 */
export async function renameFolderCommand(cmdDef: {
  oldName: string;
  newName: string;
  withPage?: boolean;
}) {
  const { oldName, newName } = cmdDef;
  const fileList = await filesUnderPrefix(`${oldName}/`, `${newName}/`);
  if (cmdDef.withPage) {
    fileList.unshift([`${oldName}.md`, `${newName}.md`]);
  }
  if (!(await confirmBatch(`Move "${oldName}" to "${newName}"?`, fileList))) {
    return false;
  }
  const moved = await batchRenameFiles(fileList);
  if (moved) await moveFolders(oldName, newName);
  return moved;
}

/**
 * Moving a folder's files leaves its folders behind, empty ones included:
 * recreates them under the new name, then removes the old ones. A no-op
 * where the space keeps no folders of its own.
 */
async function moveFolders(oldName: string, newName: string): Promise<void> {
  const folders = ((await space.listFolders()) ?? [])
    .filter((folder) => folder === oldName || folder.startsWith(`${oldName}/`))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  for (const folder of folders) {
    await space.createFolder(newName + folder.slice(oldName.length));
  }
  for (const folder of folders.reverse()) {
    try {
      await space.deleteFolder(folder);
    } catch (e) {
      // Something that didn't move is still in it; leave it be
      console.warn("Kept folder after move", folder, e);
    }
  }
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

/** The link text a rename writes for `name`, with `vanishingName` on its way out. */
async function wikiLinkTextFor(
  name: string,
  vanishingName?: string,
): Promise<string> {
  const path = parseToRef(name)?.path;
  if (!path) {
    return name;
  }
  const writeFormat = await linkWriteFormat();

  const lookups = await space.lookupPaths([path]);
  const index = new BasenameIndex();
  index.rebuild([...(lookups[path]?.candidates ?? []), path]);

  const vanishingPath = vanishingName
    ? parseToRef(vanishingName)?.path
    : undefined;
  if (vanishingPath) {
    index.delete(vanishingPath);
  }

  return writtenLinkText(path, writeFormat, index);
}

/**
 * Updates backlinks across all pages
 * @param oldName Full path to old page/file
 * @param newName Full path to new page/file
 * @returns The number of references updated
 */
export async function updateBacklinks(
  oldName: string,
  newName: string,
  wikiNameOverride?: string,
  wikiLinksOnly = false,
): Promise<number> {
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

    const splices: Splice[] = [];
    for (const rec of recsInPage) {
      const range = rec.range;
      if (!range) continue;
      if (wikiLinksOnly && !isWikiLinkAt(text, range)) {
        continue;
      }
      splices.push({
        range,
        apply: (text) =>
          spliceReference({
            text,
            range,
            oldName,
            newName,
            newWikiName,
            pageToEdit,
          }),
      });
    }
    if (splices.length > 0) {
      const regions = yamlRegions(await markdown.parseMarkdown(text));
      const applied = applySplices(text, splices, regions);
      text = applied.text;
      updatedReferences += applied.changed;
    }
    // Nothing changed (every splice was a no-op): don't churn the file's
    // mtime with a byte-identical write.
    if (text !== original) {
      await space.writePage(pageToEdit, text);
    }
  }

  return updatedReferences;
}

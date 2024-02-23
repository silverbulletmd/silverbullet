import { editor, space } from "$sb/syscalls.ts";
import { validatePageName } from "../../plug-api/lib/page_ref.ts";
import { getBackLinks } from "./page_links.ts";

/**
 * Renames a single page.
 * @param cmdDef Optional command arguments
 * @param cmdDef.oldPage The current name of the page to rename. Defaults to
 *   the current page selected in the editor.
 * @param cmdDef.page The name to rename the page to. If not provided the
 *   user will be prompted to enter a new name.
 * @param cmdDef.navigateThere When true, the user will be navigated to the
 *   renamed page. Defaults to true.
 * @returns True if the rename succeeded; otherwise, false.
 */
export async function renamePageCommand(cmdDef: any) {
  const oldName = cmdDef.oldPage || await editor.getCurrentPage();
  console.log("Old name is", oldName);
  const newName = cmdDef.page ||
    await editor.prompt(`Rename ${oldName} to:`, oldName);
  if (!newName) {
    return false;
  }

  try {
    validatePageName(newName);
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
    return false;
  }

  console.log("New name", newName);

  if (newName.trim() === oldName.trim()) {
    // Nothing to do here
    console.log("Name unchanged, exiting");
    return false;
  }

  await editor.save();

  try {
    console.log(
      "Checking if target page already exists, this should result in a 'Not found' error",
    );
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
        throw e;
      }
    }
    const updatedReferences = await renamePage(
      oldName,
      newName,
      cmdDef.navigateThere ?? true,
    );

    await editor.flashNotification(
      `Renamed page, and updated ${updatedReferences} references`,
    );
    return true;
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
    return false;
  }
}

async function renamePage(
  oldName: string,
  newName: string,
  navigateThere = false,
): Promise<number> {
  const text = await space.readPage(oldName);

  console.log("Writing new page to space");
  const newPageMeta = await space.writePage(newName, text);

  if (navigateThere) {
    console.log("Navigating to new page");
    await editor.navigate({ page: newName, pos: 0 }, true);
  }

  const pagesToUpdate = await getBackLinks(oldName);
  console.log("All pages containing backlinks", pagesToUpdate);

  // Handling the edge case of a changing page name just in casing on a case insensitive FS
  const oldPageMeta = await space.getPageMeta(oldName);
  if (oldPageMeta.lastModified !== newPageMeta.lastModified) {
    // If they're the same, let's assume it's the same file (case insensitive FS) and not delete, otherwise...
    console.log("Deleting page from space");
    await space.deletePage(oldName);
  }

  // This is the bit where we update all the links
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

    // Replace all links found in place following the patterns [[Page]] and [[Page@pos]] as well as [[Page$anchor]]
    const newText = text.replaceAll(`[[${oldName}]]`, () => {
      // Plain link format
      updatedReferences++;
      return `[[${newName}]]`;
    }).replaceAll(`[[${oldName}|`, () => {
      // Aliased link format
      updatedReferences++;
      return `[[${newName}|`;
    }).replaceAll(`[[${oldName}@`, () => {
      // Link with position format
      updatedReferences++;
      return `[[${newName}@`;
    }).replaceAll(`[[${oldName}$`, () => {
      // Link with anchor format
      updatedReferences++;
      return `[[${newName}$`;
    }).replaceAll(`[[${oldName}#`, () => {
      // Link with header format
      updatedReferences++;
      return `[[${newName}#`;
    });
    if (text !== newText) {
      console.log("Changes made, saving...");
      await space.writePage(pageToUpdate, newText);
    }
  }

  return updatedReferences;
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
  const oldPrefix = cmdDef.oldPrefix ??
    await editor.prompt("Prefix to rename:", "");

  if (!oldPrefix) {
    return false;
  }

  const newPrefix = cmdDef.newPrefix ??
    await editor.prompt("New prefix:", oldPrefix);

  if (!newPrefix) {
    return false;
  }

  const allPages = await space.listPages();
  const allAffectedPages = allPages.map((page) => page.name).filter((page) =>
    page.startsWith(oldPrefix)
  );

  if (
    cmdDef.disableConfirmation !== true && !(await editor.confirm(
      `This will affect ${allAffectedPages.length} pages. Are you sure?`,
    ))
  ) {
    return false;
  }

  const allNewNames = allAffectedPages.map((name) =>
    // This may seem naive, but it's actually fine, because we're only renaming the first occurrence (which will be the prefix)
    name.replace(oldPrefix, newPrefix)
  );

  try {
    console.log("Pre-flight check to see if all new names are available");
    await Promise.all(allNewNames.map(async (name) => {
      try {
        await space.getPageMeta(name);
        // If we got here, the page exists, so we error out
        throw Error(
          `Target ${name} already exists, cannot perform batch rename when one of the target pages already exists.`,
        );
      } catch (e: any) {
        if (e.message === "Not found") {
          // Expected not found error, so we can continue
        } else {
          throw e;
        }
      }
    }));

    console.log("All new names are available, proceeding with rename");
    for (let i = 0; i < allAffectedPages.length; i++) {
      const oldName = allAffectedPages[i];
      const newName = allNewNames[i];
      console.log("Now renaming", oldName, "to", newName);
      await renamePage(oldName, newName);
    }

    await editor.flashNotification("Batch rename complete", "info");
    return true;
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
    return false;
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
  if (!newName) {
    return;
  }

  console.log("New name", newName);

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
  await editor.replaceRange(selection.from, selection.to, `[[${newName}]]`);
  console.log("Writing new page to space");
  await space.writePage(newName, text);
  console.log("Navigating to new page");
  await editor.navigate({ page: newName });
}

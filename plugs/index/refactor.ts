import { editor, space } from "$sb/syscalls.ts";
import { validatePageName } from "$sb/lib/page.ts";
import { getBackLinks } from "./page_links.ts";

export async function renamePageCommand(cmdDef: any) {
  const oldName = await editor.getCurrentPage();
  console.log("Old name is", oldName);
  const newName = cmdDef.page ||
    await editor.prompt(`Rename ${oldName} to:`, oldName);
  if (!newName) {
    return;
  }

  try {
    validatePageName(newName);
  } catch (e: any) {
    return editor.flashNotification(e.message, "error");
  }

  console.log("New name", newName);

  if (newName.trim() === oldName.trim()) {
    // Nothing to do here
    console.log("Name unchanged, exiting");
    return;
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
    const updatedReferences = await renamePage(oldName, newName, true);

    await editor.flashNotification(
      `Renamed page, and updated ${updatedReferences} references`,
    );
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
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
    await editor.navigate(newName, 0, true);
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

    const newText = text.replaceAll(`[[${oldName}]]`, () => {
      updatedReferences++;
      return `[[${newName}]]`;
    }).replaceAll(`[[${oldName}@`, () => {
      updatedReferences++;
      return `[[${newName}@`;
    });
    if (text !== newText) {
      console.log("Changes made, saving...");
      await space.writePage(pageToUpdate, newText);
    }
  }

  return updatedReferences;
}

export async function renamePrefixCommand() {
  const oldPrefix = await editor.prompt("Prefix to rename:", "");
  if (!oldPrefix) {
    return;
  }
  const newPrefix = await editor.prompt("New prefix:", oldPrefix);
  if (!newPrefix) {
    return;
  }

  const allPages = await space.listPages();
  const allAffectedPages = allPages.map((page) => page.name).filter((page) =>
    page.startsWith(oldPrefix)
  );

  if (
    !(await editor.confirm(
      `This will affect ${allAffectedPages.length} pages. Are you sure?`,
    ))
  ) {
    return;
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
  } catch (e: any) {
    return editor.flashNotification(e.message, "error");
  }
}

export async function extractToPageCommand() {
  const newName = await editor.prompt(`New page title:`, "new page");
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
  let text = await editor.getText();
  const selection = await editor.getSelection();
  text = text.slice(selection.from, selection.to);
  await editor.replaceRange(selection.from, selection.to, `[[${newName}]]`);
  console.log("Writing new page to space");
  await space.writePage(newName, text);
  console.log("Navigating to new page");
  await editor.navigate(newName);
}

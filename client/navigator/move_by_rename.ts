import { system } from "@silverbulletmd/silverbullet/syscalls";

/**
 * A tree view's `onMove`: renames what the row stands for. A folder moves
 * with everything in it (and its empty folders), and with the page of the
 * same name when the row is both.
 */
export async function moveByRename(obj: any, newName: string): Promise<void> {
  if (obj.isFolder) {
    // One batch, one confirmation: the folder's files and, for a folder that
    // is also a page, that page.
    await system.invokeFunction("index.renameFolderCommand", {
      oldName: obj.name,
      newName,
      withPage: !!obj.ref,
    });
  } else {
    if (obj.tag === "document") {
      // A document's name already carries its extension, so the page rename (which appends ".md") would target the wrong file.
      await system.invokeFunction("index.renameDocumentCommand", {
        oldDocument: obj.name,
        document: newName,
      });
    } else {
      await system.invokeFunction("index.renamePageCommand", {
        oldPage: obj.name,
        page: newName,
      });
    }
  }
}

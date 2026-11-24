import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import { leaveBeforeDeleting } from "@silverbulletmd/silverbullet/lib/leave_deleted";
import { editor, space } from "@silverbulletmd/silverbullet/syscalls";

export async function deletePage() {
  const pageName = await editor.getCurrentPage();
  if (
    !(await editor.confirm(
      `Are you sure you would like to delete ${pageName}?`,
      { destructive: true },
    ))
  ) {
    return;
  }
  await leaveBeforeDeleting((path) => path === `${pageName}.md`);
  await space.deletePage(pageName);
}

export async function copyPage(
  _def: any,
  sourcePage?: string,
  toName?: string,
) {
  const currentPage = await editor.getCurrentPage();
  const fromName = sourcePage || currentPage;
  const suggestedName = toName || fromName;

  let newName = await editor.prompt(`Copy to page:`, suggestedName);
  if (newName === undefined) {
    return;
  }
  newName = newName.trim();
  if (newName === "") {
    void editor.flashNotification(
      "Must provide a non-empty page name.",
      "error",
    );
    return;
  }

  try {
    // This throws an error if the page does not exist, which we expect to be the case
    await space.getPageMeta(newName);
    throw new Error(
      `"${newName}" already exists, cannot copy to existing page.`,
    );
  } catch (e: any) {
    if (e.message === notFoundError.message) {
      // Expected not found error, so we can continue
    } else {
      await editor.flashNotification(e.message, "error");
      throw e;
    }
  }

  const text = await space.readPage(fromName);

  console.log("Writing new page to space");
  await space.writePage(newName, text);

  if (currentPage === fromName) {
    console.log("Navigating to new page");
    await editor.navigate(newName);
  } else {
    await editor.flashNotification("Page copied successfully");
  }
}

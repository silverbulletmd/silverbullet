import { editor, space } from "@silverbulletmd/silverbullet/syscalls";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";

export async function deletePage() {
  const pageName = await editor.getCurrentPage();
  if (
    !await editor.confirm(`Are you sure you would like to delete ${pageName}?`)
  ) {
    return;
  }
  // Query for last
  const recentlyOpenedPages = await editor.getRecentlyOpenedPages();
  const allPages = await space.listPages();
  const existingPageNames = new Set(allPages.map(p => p.name));

  // Find the first recently opened page that still exists and is not the current page
  const firstRecentlyOpenedPage = recentlyOpenedPages.find(
    (page) => page.name !== pageName && existingPageNames.has(page.name)
  );
  await space.deletePage(pageName);
  console.log("Navigating to previous page");
  await editor.navigate(firstRecentlyOpenedPage?.name || "");
}

export async function copyPage(
  _def: any,
  sourcePage?: string,
  toName?: string,
) {
  const currentPage = await editor.getCurrentPage();
  const fromName = sourcePage || currentPage;
  const suggestedName = toName || fromName;

  const newName = await editor.prompt(`Copy to page:`, suggestedName);

  if (!newName) {
    return;
  }

  try {
    // This throws an error if the page does not exist, which we expect to be the case
    await space.getPageMeta(newName);
    // So when we get to this point, we error out
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
    // If we're copying the current page, navigate there
    console.log("Navigating to new page");
    await editor.navigate(newName);
  } else {
    // Otherwise just notify of success
    await editor.flashNotification("Page copied successfully");
  }
}

import { editor, space } from "$sb/syscalls.ts";

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

import { editor, space } from "$sb/syscalls.ts";
import { isFederationPath } from "$sb/lib/resolve.ts";

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

export async function copyPage(_def: any, predefinedNewName: string) {
  const oldName = await editor.getCurrentPage();
  let suggestedName = predefinedNewName || oldName;

  if (isFederationPath(oldName)) {
    const pieces = oldName.split("/");
    suggestedName = pieces.slice(1).join("/");
  }
  const newName = await editor.prompt(`Copy to new page:`, suggestedName);

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

import { editor, space, system } from "$sb/silverbullet-syscall/mod.ts";
import { renderDirectives } from "./directives.ts";

export async function updateDirectivesOnPageCommand() {
  const currentPage = await editor.getCurrentPage();
  await editor.save();
  if (
    await system.invokeFunction(
      "server",
      "updateDirectivesOnPage",
      currentPage,
    )
  ) {
    await editor.reloadPage();
  }
}

// Called from client, running on server
export async function updateDirectivesOnPage(
  pageName: string,
): Promise<boolean> {
  let text = "";
  try {
    text = await space.readPage(pageName);
  } catch {
    console.warn(
      "Could not read page",
      pageName,
      "perhaps it doesn't yet exist",
    );
    return false;
  }
  const newText = await renderDirectives(pageName, text);
  if (text !== newText) {
    await space.writePage(pageName, newText);
    return true;
  }
  return false;
}

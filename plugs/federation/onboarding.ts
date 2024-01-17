import { editor, space } from "$sb/syscalls.ts";
import { cacheFileListing, readFile } from "./federation.ts";

const defaultUri = "!localhost:3001/template";

export async function importTemplateSet(_def: any, uri = defaultUri) {
  const allTemplates = await cacheFileListing(uri);
  for (const template of allTemplates) {
    if (!template.name.endsWith(".md")) {
      continue;
    }

    // Clean up file path
    let pageName = template.name.replace(/\.md$/, "");
    // Remove the federation part
    const pieces = pageName.split("/");
    pageName = pieces.slice(1).join("/");

    // Fetch the file
    const buf = (await readFile(template.name)).data;

    try {
      // Check if it already exists
      await space.getPageMeta(pageName);

      if (
        !await editor.confirm(
          `Page ${pageName} already exists, are you sure you want to override it?`,
        )
      ) {
        continue;
      }
    } catch {
      // Expected
    }

    // Write to local space
    await space.writePage(pageName, new TextDecoder().decode(buf));
  }
  await editor.flashNotification("Import complete!");
}

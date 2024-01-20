import { editor, space } from "$sb/syscalls.ts";
import { cacheFileListing, readFile } from "./federation.ts";

export async function importLibraryCommand(_def: any, uri?: string) {
  if (!uri) {
    uri = await editor.prompt("Import library (federation URL):");
  }
  if (!uri) {
    return;
  }
  uri = uri.trim();
  if (!uri.startsWith("!")) {
    uri = `!${uri}`;
  }
  const allTemplates = (await cacheFileListing(uri)).filter((f) =>
    f.name.endsWith(".md")
  );
  if (
    !await editor.confirm(
      `You are about to import ${allTemplates.length} templates, want to do this?`,
    )
  ) {
    return;
  }
  for (const template of allTemplates) {
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

    await editor.flashNotification(`Imported ${pageName}`);
  }
  await editor.reloadSettingsAndCommands();
  await editor.flashNotification("Import complete!");
}

import { editor, space } from "$sb/syscalls.ts";
import { readSetting } from "$sb/lib/settings_page.ts";
import { listFilesCached, readFile } from "./federation.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";
import { invokeFunction } from "$sb/syscalls/system.ts";
import { federatedPathToLocalPath, wildcardPathToRegex } from "./util.ts";
import { confirm } from "$sb/syscalls/editor.ts";

type LibraryDef = {
  /**
   * @deprecated Use `import` instead
   */
  source?: string;
  import: string;
  exclude?: string[];
};

export async function updateLibrariesCommand() {
  if (
    await confirm(
      "Are you sure you want to update all libraries (as specified in SETTINGS)?",
    )
  ) {
    await editor.flashNotification("Updating all libraries...");
    const updateStats: UpdateStats = await invokeFunction(
      "federation.updateLibraries",
    );
    await editor.reloadSettingsAndCommands();
    await editor.flashNotification(
      `Updated ${updateStats.libraries} libraries containing a total of ${updateStats.items} items.`,
    );
  }
}

type UpdateStats = {
  libraries: number;
  items: number;
};

// Run on the server for efficiency and CORS avoidance
export async function updateLibraries(): Promise<UpdateStats> {
  const updateStats: UpdateStats = { libraries: 0, items: 0 };
  const libraries = (await readSetting("libraries", [])) as LibraryDef[];
  for (const lib of libraries) {
    // Handle deprecated 'source' field
    if (lib.source) {
      lib.import = lib.source;
    }
    if (!lib.import) {
      console.warn("Library source not set, skipping", lib);
      continue;
    }
    const pageUri = parsePageRef(lib.import).page;

    if (!pageUri.startsWith("!")) {
      console.warn(
        "Library source must be a federated page, skipping",
        pageUri,
      );
      continue;
    }

    console.log("Now updating library", pageUri);

    const localLibraryPath = federatedPathToLocalPath(pageUri);

    // Sanity check the `source` pattern to avoid disaster (like wiping out the whole space)
    if (!/^Library\/.+/.test(localLibraryPath)) {
      console.warn(
        "Skipping library",
        pageUri,
        "as it does not start with Library/",
      );
      continue;
    }

    // Fetch new list of pages
    let newPages = await listFilesCached(pageUri, true);
    console.log("All pages", newPages.length);
    if (lib.exclude) {
      for (const exclude of lib.exclude) {
        const excludeUri = parsePageRef(exclude).page;
        const excludeRegex = wildcardPathToRegex(excludeUri + ".md");
        newPages = newPages.filter((p) => {
          if (excludeRegex.test(p.name)) {
            console.info("Excluding", p.name);
            return false;
          }
          return true;
        });
      }
    }

    // Compile existing page list in local space (to be removed)
    const localPages = await space.listPages();
    const localSourceRegex = wildcardPathToRegex(localLibraryPath);

    // Remove pages that match the source pattern, but in their "local" form
    const pagesToRemove = localPages.filter((p) =>
      localSourceRegex.test(p.name)
    );
    console.log("Pages to remove", pagesToRemove.length);
    for (const page of pagesToRemove) {
      console.info("Deleting", page.name);
      await space.deletePage(page.name);
    }

    // Import the new pages
    for (const page of newPages) {
      console.info("Importing", page.name);
      // Fetch the file
      const buf = (await readFile(page.name)).data;

      // Write to local space
      await space.writeFile(federatedPathToLocalPath(page.name), buf);

      updateStats.items++;
    }

    updateStats.libraries++;
    console.log("Done with library", pageUri);
  }
  return updateStats;
}

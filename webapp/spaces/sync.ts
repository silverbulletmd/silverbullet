import { WatchableSpace } from "./cache_space";
import { PageMeta } from "../../common/types";
import { Space } from "./space";

export class SpaceSync {
  constructor(
    private primary: WatchableSpace,
    private secondary: WatchableSpace,
    public lastSync: number,
    private trashPrefix: string
  ) {}

  // Strategy: Primary wins
  public static primaryConflictResolver(
    primary: WatchableSpace,
    secondary: WatchableSpace
  ): (pageMeta1: PageMeta, pageMeta2: PageMeta) => Promise<void> {
    return async (pageMeta1, pageMeta2) => {
      const pageName = pageMeta1.name;
      const revisionPageName = `${pageName}.conflicted.${pageMeta2.lastModified}`;
      // Copy secondary to conflict copy
      let oldPageData = await secondary.readPage(pageName);
      await secondary.writePage(revisionPageName, oldPageData.text);

      // Write replacement on top
      let newPageData = await primary.readPage(pageName);
      await secondary.writePage(
        pageName,
        newPageData.text,
        true,
        newPageData.meta.lastModified
      );
    };
  }

  async syncablePages(space: Space): Promise<PageMeta[]> {
    return [...(await space.fetchPageList())].filter(
      (pageMeta) => !pageMeta.name.startsWith(this.trashPrefix)
    );
  }

  async trashPages(space: Space): Promise<PageMeta[]> {
    return [...(await space.fetchPageList())]
      .filter((pageMeta) => pageMeta.name.startsWith(this.trashPrefix))
      .map((pageMeta) => ({
        ...pageMeta,
        name: pageMeta.name.substring(this.trashPrefix.length),
      }));
  }

  async syncPages(
    conflictResolver?: (
      pageMeta1: PageMeta,
      pageMeta2: PageMeta
    ) => Promise<void>
  ): Promise<number> {
    let syncOps = 0;

    let allPagesPrimary = new Map(
      (await this.syncablePages(this.primary)).map((p) => [p.name, p])
    );
    let allPagesSecondary = new Map(
      (await this.syncablePages(this.secondary)).map((p) => [p.name, p])
    );
    let allTrashPrimary = new Map(
      (await this.trashPages(this.primary))
        // Filter out old trash
        .filter((p) => p.lastModified > this.lastSync)
        .map((p) => [p.name, p])
    );
    let allTrashSecondary = new Map(
      (await this.trashPages(this.secondary))
        // Filter out old trash
        .filter((p) => p.lastModified > this.lastSync)
        .map((p) => [p.name, p])
    );

    let createdPagesOnSecondary = new Set<string>();

    // Iterate over all pages on the primary first
    for (let [name, pageMetaPrimary] of allPagesPrimary.entries()) {
      let pageMetaSecondary = allPagesSecondary.get(pageMetaPrimary.name);
      if (!pageMetaSecondary) {
        // New page on primary
        // Let's check it's not on the deleted list
        if (allTrashSecondary.has(name)) {
          // Explicitly deleted, let's skip
          continue;
        }

        // Push from primary to secondary
        console.log("New page on primary", name, "syncing to secondary");
        let pageData = await this.primary.readPage(name);
        await this.secondary.writePage(
          name,
          pageData.text,
          true,
          pageData.meta.lastModified
        );
        syncOps++;
        createdPagesOnSecondary.add(name);
      } else {
        // Existing page
        if (pageMetaPrimary.lastModified > this.lastSync) {
          // Primary updated since last sync
          if (pageMetaSecondary.lastModified > this.lastSync) {
            // Secondary also updated! CONFLICT
            if (conflictResolver) {
              await conflictResolver(pageMetaPrimary, pageMetaSecondary);
            } else {
              throw Error(
                `Sync conflict for ${name} with no conflict resolver specified`
              );
            }
          } else {
            // Ok, not changed on secondary, push it secondary
            console.log(
              "Changed page on primary",
              name,
              "syncing to secondary"
            );
            let pageData = await this.primary.readPage(name);
            await this.secondary.writePage(
              name,
              pageData.text,
              false,
              pageData.meta.lastModified
            );
            syncOps++;
          }
        } else if (pageMetaSecondary.lastModified > this.lastSync) {
          // Secondary updated, but not primary (checked above)
          // Push from secondary to primary
          console.log("Changed page on secondary", name, "syncing to primary");
          let pageData = await this.secondary.readPage(name);
          await this.primary.writePage(
            name,
            pageData.text,
            false,
            pageData.meta.lastModified
          );
          syncOps++;
        } else {
          // Neither updated, no-op
        }
      }
    }

    // Now do a simplified version in reverse, only detecting new pages
    for (let [name, pageMetaSecondary] of allPagesSecondary.entries()) {
      if (!allPagesPrimary.has(pageMetaSecondary.name)) {
        // New page on secondary
        // Let's check it's not on the deleted list
        if (allTrashPrimary.has(name)) {
          // Explicitly deleted, let's skip
          continue;
        }
        // Push from secondary to primary
        console.log("New page on secondary", name, "pushing to primary");
        let pageData = await this.secondary.readPage(name);
        await this.primary.writePage(
          name,
          pageData.text,
          true,
          pageData.meta.lastModified
        );
        syncOps++;
      }
    }

    // And finally, let's trash some pages
    for (let pageToDelete of allTrashPrimary.values()) {
      if (pageToDelete.lastModified > this.lastSync) {
        // New deletion
        console.log("Deleting", pageToDelete.name, "on secondary");
        try {
          await this.secondary.deletePage(
            pageToDelete.name,
            pageToDelete.lastModified
          );
          syncOps++;
        } catch (e: any) {
          console.log("Page already gone", e.message);
        }
      }
    }

    for (let pageToDelete of allTrashSecondary.values()) {
      if (pageToDelete.lastModified > this.lastSync) {
        // New deletion
        console.log("Deleting", pageToDelete.name, "on primary");
        try {
          await this.primary.deletePage(
            pageToDelete.name,
            pageToDelete.lastModified
          );
          syncOps++;
        } catch (e: any) {
          console.log("Page already gone", e.message);
        }
      }
    }

    // Find the latest timestamp and set it as lastSync
    allPagesPrimary.forEach((pageMeta) => {
      this.lastSync = Math.max(this.lastSync, pageMeta.lastModified);
    });
    allPagesSecondary.forEach((pageMeta) => {
      this.lastSync = Math.max(this.lastSync, pageMeta.lastModified);
    });
    allTrashPrimary.forEach((pageMeta) => {
      this.lastSync = Math.max(this.lastSync, pageMeta.lastModified);
    });
    allTrashSecondary.forEach((pageMeta) => {
      this.lastSync = Math.max(this.lastSync, pageMeta.lastModified);
    });

    return syncOps;
  }
}

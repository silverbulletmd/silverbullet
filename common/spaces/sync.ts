import { Space } from "./space";
import { PageMeta } from "../types";
import { SpacePrimitives } from "./space_primitives";

export class SpaceSync {
  constructor(
    private primary: Space,
    private secondary: Space,
    public primaryLastSync: number,
    public secondaryLastSync: number,
    private trashPrefix: string
  ) {}

  // Strategy: Primary wins
  public static primaryConflictResolver(
    primary: Space,
    secondary: Space
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

  async syncablePages(
    space: Space
  ): Promise<{ pages: PageMeta[]; nowTimestamp: number }> {
    let fetchResult = await space.fetchPageList();
    return {
      pages: [...fetchResult.pages].filter(
        (pageMeta) => !pageMeta.name.startsWith(this.trashPrefix)
      ),
      nowTimestamp: fetchResult.nowTimestamp,
    };
  }

  async trashPages(space: SpacePrimitives): Promise<PageMeta[]> {
    return [...(await space.fetchPageList()).pages]
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

    let { pages: primaryAllPagesSet, nowTimestamp: primarySyncTimestamp } =
      await this.syncablePages(this.primary);
    let allPagesPrimary = new Map(primaryAllPagesSet.map((p) => [p.name, p]));
    let { pages: secondaryAllPagesSet, nowTimestamp: secondarySyncTimestamp } =
      await this.syncablePages(this.secondary);
    let allPagesSecondary = new Map(
      secondaryAllPagesSet.map((p) => [p.name, p])
    );

    let allTrashPrimary = new Map(
      (await this.trashPages(this.primary))
        // Filter out old trash
        .filter((p) => p.lastModified > this.primaryLastSync)
        .map((p) => [p.name, p])
    );
    let allTrashSecondary = new Map(
      (await this.trashPages(this.secondary))
        // Filter out old trash
        .filter((p) => p.lastModified > this.secondaryLastSync)
        .map((p) => [p.name, p])
    );

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
          secondarySyncTimestamp // The reason for this is to not include it in the next sync cycle, we cannot blindly use the lastModified date due to time skew
        );
        syncOps++;
      } else {
        // Existing page
        if (pageMetaPrimary.lastModified > this.primaryLastSync) {
          // Primary updated since last sync
          if (pageMetaSecondary.lastModified > this.secondaryLastSync) {
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
              secondarySyncTimestamp
            );
            syncOps++;
          }
        } else if (pageMetaSecondary.lastModified > this.secondaryLastSync) {
          // Secondary updated, but not primary (checked above)
          // Push from secondary to primary
          console.log("Changed page on secondary", name, "syncing to primary");
          let pageData = await this.secondary.readPage(name);
          await this.primary.writePage(
            name,
            pageData.text,
            false,
            primarySyncTimestamp
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
          false,
          primarySyncTimestamp
        );
        syncOps++;
      }
    }

    // And finally, let's trash some pages
    for (let pageToDelete of allTrashPrimary.values()) {
      console.log("Deleting", pageToDelete.name, "on secondary");
      try {
        await this.secondary.deletePage(
          pageToDelete.name,
          secondarySyncTimestamp
        );
        syncOps++;
      } catch (e: any) {
        console.log("Page already gone", e.message);
      }
    }

    for (let pageToDelete of allTrashSecondary.values()) {
      console.log("Deleting", pageToDelete.name, "on primary");
      try {
        await this.primary.deletePage(pageToDelete.name, primarySyncTimestamp);
        syncOps++;
      } catch (e: any) {
        console.log("Page already gone", e.message);
      }
    }

    // Setting last sync time to the timestamps we got back when fetching the page lists on each end
    this.primaryLastSync = primarySyncTimestamp;
    this.secondaryLastSync = secondarySyncTimestamp;

    return syncOps;
  }
}

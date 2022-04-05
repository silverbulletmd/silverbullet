import { Space } from "./space";

export class SpaceSync {
  lastSync: number;

  constructor(
    private primary: Space,
    private secondary: Space,
    lastSync: number
  ) {
    this.lastSync = lastSync;
  }

  async syncPages() {
    let allPagesPrimary = new Map(
      [...(await this.primary.listPages())].map((p) => [p.name, p])
    );
    let allPagesSecondary = new Map(
      [...(await this.secondary.listPages())].map((p) => [p.name, p])
    );

    let createdPagesOnSecondary = new Set<string>();

    // Iterate over all pages on the primary first
    for (let [name, pageMetaPrimary] of allPagesPrimary.entries()) {
      let pageMetaSecondary = allPagesSecondary.get(pageMetaPrimary.name);
      if (!pageMetaSecondary) {
        // New page on primary
        // Push from primary to secondary
        console.log("New page on primary", name, "syncing to secondary");
        let pageData = await this.primary.readPage(name);
        await this.secondary.writePage(
          name,
          pageData.text,
          true,
          pageData.meta
        );
        createdPagesOnSecondary.add(name);
      } else {
        // Existing page
        if (pageMetaPrimary.lastModified > this.lastSync) {
          // Primary updated since last sync
          if (pageMetaSecondary.lastModified > this.lastSync) {
            // Secondary also updated! CONFLICT
            throw Error(`Sync conflict for ${name}`);
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
              true,
              pageData.meta
            );
          }
        } else if (pageMetaSecondary.lastModified > this.lastSync) {
          // Secondary updated, but not primary (checked above)
          // Push from secondary to primary
          console.log("Changed page on secondary", name, "syncing to primary");
          let pageData = await this.secondary.readPage(name);
          await this.primary.writePage(
            name,
            pageData.text,
            true,
            pageData.meta
          );
        } else {
          // Neither updated, no-op
        }
      }
    }

    // Now do a simplified version in reverse, only detecting new pages

    // Finally, let's go over all pages on the secondary and see if the primary has them
    for (let [name, pageMetaSecondary] of allPagesSecondary.entries()) {
      if (!allPagesPrimary.has(pageMetaSecondary.name)) {
        // New page on secondary
        // Push from secondary to primary
        console.log("New page on secondary", name, "pushing to primary");
        let pageData = await this.secondary.readPage(name);
        await this.primary.writePage(name, pageData.text, true, pageData.meta);
      }
    }

    // Find the latest timestamp on the primary and set it as lastSync
    allPagesPrimary.forEach((pageMeta) => {
      this.lastSync = Math.max(this.lastSync, pageMeta.lastModified);
    });
    allPagesSecondary.forEach((pageMeta) => {
      this.lastSync = Math.max(this.lastSync, pageMeta.lastModified);
    });
  }
}

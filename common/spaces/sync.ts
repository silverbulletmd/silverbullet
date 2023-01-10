import type { FileMeta } from "../types.ts";
import { SpacePrimitives } from "./space_primitives.ts";

export type SyncStatusItem = {
  tagPrimary?: number;
  tagSecondary?: number;
};

type SyncHash = number;

export class SpaceSync {
  constructor(
    private primary: SpacePrimitives,
    private secondary: SpacePrimitives,
    private status: Map<string, SyncStatusItem>,
  ) {}

  // Inspired by https://unterwaditzer.net/2016/sync-algorithm.html
  async syncFiles(
    conflictResolver?: (
      name: string,
      primarySpace: SpacePrimitives,
      secondarySpace: SpacePrimitives,
    ) => Promise<SyncStatusItem>,
  ): Promise<number> {
    let operations = 0;
    console.log("Fetching snapshot from primary");
    const primaryAllPages = this.syncCandidates(
      (await this.primary.fetchFileList()).files,
    );

    console.log("Fetching snapshot from secondary");
    const secondaryAllPages = this.syncCandidates(
      (await this.secondary.fetchFileList()).files,
    );

    const primaryFileMap = new Map<string, SyncHash>(
      primaryAllPages.map((m) => [m.name, m.lastModified]),
    );
    const secondaryFileMap = new Map<string, SyncHash>(
      secondaryAllPages.map((m) => [m.name, m.lastModified]),
    );

    const allFilesToProcess = new Set([
      ...this.status.keys(),
      ...primaryFileMap.keys(),
      ...secondaryFileMap.keys(),
    ]);

    console.log("Iterating over all files");
    for (const name of allFilesToProcess) {
      if (
        primaryFileMap.has(name) && !secondaryFileMap.has(name) &&
        !this.status.has(name)
      ) {
        // New file, created on primary, copy from primary to secondary
        console.log("New file created on primary, copying to secondary", name);
        const { data } = await this.primary.readFile(name, "arraybuffer");
        const writtenMeta = await this.secondary.writeFile(
          name,
          "arraybuffer",
          data,
        );
        this.status.set(name, {
          tagPrimary: primaryFileMap.get(name),
          tagSecondary: writtenMeta.lastModified,
        });
        operations++;
      } else if (
        secondaryFileMap.has(name) && !primaryFileMap.has(name) &&
        !this.status.has(name)
      ) {
        // New file, created on secondary, copy from secondary to primary
        console.log(
          "New file created on secondary, copying from secondary to primary",
          name,
        );
        const { data } = await this.secondary.readFile(name, "arraybuffer");
        const writtenMeta = await this.primary.writeFile(
          name,
          "arraybuffer",
          data,
        );
        this.status.set(name, {
          tagPrimary: writtenMeta.lastModified,
          tagSecondary: secondaryFileMap.get(name),
        });
        operations++;
      } else if (
        primaryFileMap.has(name) && this.status.has(name) &&
        !secondaryFileMap.has(name)
      ) {
        // File deleted on B
        console.log("File deleted on secondary, deleting from primary", name);
        await this.primary.deleteFile(name);
        this.status.delete(name);
        operations++;
      } else if (
        secondaryFileMap.has(name) && this.status.has(name) &&
        !primaryFileMap.has(name)
      ) {
        // File deleted on A
        console.log("File deleted on primary, deleting from secondary", name);
        await this.secondary.deleteFile(name);
        this.status.delete(name);
        operations++;
      } else if (
        primaryFileMap.has(name) && secondaryFileMap.has(name) &&
        !this.status.has(name)
      ) {
        console.log(
          "Both sides have file, but no status, adding to status",
          name,
        );
        this.status.set(name, {
          tagPrimary: primaryFileMap.get(name),
          tagSecondary: secondaryFileMap.get(name),
        });
        operations++;
      } else if (
        this.status.has(name) && !primaryFileMap.has(name) &&
        !secondaryFileMap.has(name)
      ) {
        // File deleted on both sides, :shrug:
        console.log("File deleted on both ends, deleting from status", name);
        this.status.delete(name);
        operations++;
      } else if (
        primaryFileMap.has(name) && secondaryFileMap.has(name) &&
        this.status.get(name) &&
        primaryFileMap.get(name) !== this.status.get(name)!.tagPrimary &&
        secondaryFileMap.get(name) === this.status.get(name)!.tagSecondary
      ) {
        // File has changed on primary, but not secondary: copy from primary to secondary
        console.log("File changed on primary, copying to secondary", name);
        const { data } = await this.primary.readFile(name, "arraybuffer");
        const writtenMeta = await this.secondary.writeFile(
          name,
          "arraybuffer",
          data,
        );
        this.status.set(name, {
          tagPrimary: primaryFileMap.get(name),
          tagSecondary: writtenMeta.lastModified,
        });
        operations++;
      } else if (
        primaryFileMap.has(name) && secondaryFileMap.has(name) &&
        this.status.get(name) &&
        secondaryFileMap.get(name) !== this.status.get(name)!.tagSecondary &&
        primaryFileMap.get(name) === this.status.get(name)!.tagPrimary
      ) {
        // File has changed on secondary, but not primary: copy from secondary to primary
        const { data } = await this.secondary.readFile(name, "arraybuffer");
        const writtenMeta = await this.primary.writeFile(
          name,
          "arraybuffer",
          data,
        );
        this.status.set(name, {
          tagPrimary: writtenMeta.lastModified,
          tagSecondary: secondaryFileMap.get(name),
        });
        operations++;
      } else if (
        primaryFileMap.has(name) && secondaryFileMap.has(name) &&
        this.status.get(name) &&
        secondaryFileMap.get(name) !== this.status.get(name)!.tagSecondary &&
        primaryFileMap.get(name) !== this.status.get(name)!.tagPrimary
      ) {
        // File changed on both ends, CONFLICT!
        console.log("File changed on both ends, conflict!", name);
        if (conflictResolver) {
          this.status.set(
            name,
            await conflictResolver(name, this.primary, this.secondary),
          );
        } else {
          throw Error(
            `Sync conflict for ${name} with no conflict resolver specified`,
          );
        }
        operations++;
      } else {
        // Nothing needs to happen
      }
    }

    return operations;
  }

  // Strategy: Primary wins
  public static async primaryConflictResolver(
    name: string,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<SyncStatusItem> {
    console.log("Hit a conflict for", name);
    const filePieces = name.split(".");
    const fileNameBase = filePieces.slice(0, -1).join(".");
    const fileNameExt = filePieces[filePieces.length - 1];
    const pageMeta1 = await primary.getFileMeta(name);
    const pageMeta2 = await secondary.getFileMeta(name);
    const revisionFileName = filePieces.length === 1
      ? `${name}.conflicted.${pageMeta2.lastModified}`
      : `${fileNameBase}.conflicted.${pageMeta2.lastModified}.${fileNameExt}`;
    // Copy secondary to conflict copy
    const oldFileData = await secondary.readFile(name, "arraybuffer");
    await secondary.writeFile(
      revisionFileName,
      "arraybuffer",
      oldFileData.data,
    );

    // Write replacement on top
    const newFileData = await primary.readFile(name, "arraybuffer");
    const writeMeta = await secondary.writeFile(
      name,
      "arraybuffer",
      newFileData.data,
      true,
      newFileData.meta.lastModified,
    );

    return {
      tagPrimary: pageMeta1.lastModified,
      tagSecondary: writeMeta.lastModified,
    };
  }

  syncCandidates(files: FileMeta[]): FileMeta[] {
    return files.filter((f) => !f.name.startsWith("_plug/"));
  }
}

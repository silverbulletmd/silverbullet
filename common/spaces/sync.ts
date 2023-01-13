import type { FileMeta } from "../types.ts";
import { SpacePrimitives } from "./space_primitives.ts";

type SyncHash = number;

// Tuple where the first value represents a lastModified timestamp for the primary space
// and the second item the lastModified value of the secondary space
export type SyncStatusItem = [SyncHash, SyncHash];

// Implementation of this algorithm https://unterwaditzer.net/2016/sync-algorithm.html
export class SpaceSync {
  constructor(
    private primary: SpacePrimitives,
    private secondary: SpacePrimitives,
    readonly snapshot: Map<string, SyncStatusItem>,
  ) {}

  async syncFiles(
    conflictResolver?: (
      name: string,
      snapshot: Map<string, SyncStatusItem>,
      primarySpace: SpacePrimitives,
      secondarySpace: SpacePrimitives,
    ) => Promise<void>,
  ): Promise<number> {
    let operations = 0;
    console.log("Fetching snapshot from primary");
    const primaryAllPages = this.syncCandidates(
      await this.primary.fetchFileList(),
    );

    console.log("Fetching snapshot from secondary");
    try {
      const secondaryAllPages = this.syncCandidates(
        await this.secondary.fetchFileList(),
      );

      const primaryFileMap = new Map<string, SyncHash>(
        primaryAllPages.map((m) => [m.name, m.lastModified]),
      );
      const secondaryFileMap = new Map<string, SyncHash>(
        secondaryAllPages.map((m) => [m.name, m.lastModified]),
      );

      const allFilesToProcess = new Set([
        ...this.snapshot.keys(),
        ...primaryFileMap.keys(),
        ...secondaryFileMap.keys(),
      ]);

      console.log("Iterating over all files");
      for (const name of allFilesToProcess) {
        if (
          primaryFileMap.has(name) && !secondaryFileMap.has(name) &&
          !this.snapshot.has(name)
        ) {
          // New file, created on primary, copy from primary to secondary
          console.log(
            "New file created on primary, copying to secondary",
            name,
          );
          const { data } = await this.primary.readFile(name, "arraybuffer");
          const writtenMeta = await this.secondary.writeFile(
            name,
            "arraybuffer",
            data,
          );
          this.snapshot.set(name, [
            primaryFileMap.get(name)!,
            writtenMeta.lastModified,
          ]);
          operations++;
        } else if (
          secondaryFileMap.has(name) && !primaryFileMap.has(name) &&
          !this.snapshot.has(name)
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
          this.snapshot.set(name, [
            writtenMeta.lastModified,
            secondaryFileMap.get(name)!,
          ]);
          operations++;
        } else if (
          primaryFileMap.has(name) && this.snapshot.has(name) &&
          !secondaryFileMap.has(name)
        ) {
          // File deleted on B
          console.log("File deleted on secondary, deleting from primary", name);
          await this.primary.deleteFile(name);
          this.snapshot.delete(name);
          operations++;
        } else if (
          secondaryFileMap.has(name) && this.snapshot.has(name) &&
          !primaryFileMap.has(name)
        ) {
          // File deleted on A
          console.log("File deleted on primary, deleting from secondary", name);
          await this.secondary.deleteFile(name);
          this.snapshot.delete(name);
          operations++;
        } else if (
          this.snapshot.has(name) && !primaryFileMap.has(name) &&
          !secondaryFileMap.has(name)
        ) {
          // File deleted on both sides, :shrug:
          console.log("File deleted on both ends, deleting from status", name);
          this.snapshot.delete(name);
          operations++;
        } else if (
          primaryFileMap.has(name) && secondaryFileMap.has(name) &&
          this.snapshot.get(name) &&
          primaryFileMap.get(name) !== this.snapshot.get(name)![0] &&
          secondaryFileMap.get(name) === this.snapshot.get(name)![1]
        ) {
          // File has changed on primary, but not secondary: copy from primary to secondary
          console.log("File changed on primary, copying to secondary", name);
          const { data } = await this.primary.readFile(name, "arraybuffer");
          const writtenMeta = await this.secondary.writeFile(
            name,
            "arraybuffer",
            data,
          );
          this.snapshot.set(name, [
            primaryFileMap.get(name)!,
            writtenMeta.lastModified,
          ]);
          operations++;
        } else if (
          primaryFileMap.has(name) && secondaryFileMap.has(name) &&
          this.snapshot.get(name) &&
          secondaryFileMap.get(name) !== this.snapshot.get(name)![1] &&
          primaryFileMap.get(name) === this.snapshot.get(name)![0]
        ) {
          // File has changed on secondary, but not primary: copy from secondary to primary
          const { data } = await this.secondary.readFile(name, "arraybuffer");
          const writtenMeta = await this.primary.writeFile(
            name,
            "arraybuffer",
            data,
          );
          this.snapshot.set(name, [
            writtenMeta.lastModified,
            secondaryFileMap.get(name)!,
          ]);
          operations++;
        } else if (
          ( // File changed on both ends, but we don't have any info in the snapshot (resync scenario?): have to run through conflict handling
            primaryFileMap.has(name) && secondaryFileMap.has(name) &&
            !this.snapshot.has(name)
          ) ||
          ( // File changed on both ends, CONFLICT!
            primaryFileMap.has(name) && secondaryFileMap.has(name) &&
            this.snapshot.get(name) &&
            secondaryFileMap.get(name) !== this.snapshot.get(name)![1] &&
            primaryFileMap.get(name) !== this.snapshot.get(name)![0]
          )
        ) {
          console.log("File changed on both ends, conflict!", name);
          if (conflictResolver) {
            await conflictResolver(
              name,
              this.snapshot,
              this.primary,
              this.secondary,
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
    } catch (e: any) {
      console.error("Boom", e.message);
      throw e;
    }

    return operations;
  }

  // Strategy: Primary wins
  public static async primaryConflictResolver(
    name: string,
    snapshot: Map<string, SyncStatusItem>,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<void> {
    console.log("Hit a conflict for", name);
    const filePieces = name.split(".");
    const fileNameBase = filePieces.slice(0, -1).join(".");
    const fileNameExt = filePieces[filePieces.length - 1];
    const pageData1 = await primary.readFile(name, "arraybuffer");
    const pageData2 = await secondary.readFile(name, "arraybuffer");

    let byteWiseMatch = true;
    const arrayBuffer1 = new Uint8Array(pageData1.data as ArrayBuffer);
    const arrayBuffer2 = new Uint8Array(pageData2.data as ArrayBuffer);
    if (arrayBuffer1.byteLength !== arrayBuffer2.byteLength) {
      byteWiseMatch = false;
    }
    if (byteWiseMatch) {
      // Byte-wise comparison
      for (let i = 0; i < arrayBuffer1.byteLength; i++) {
        if (arrayBuffer1[i] !== arrayBuffer2[i]) {
          byteWiseMatch = false;
          break;
        }
      }
      // Byte wise they're still the same, so no confict
      if (byteWiseMatch) {
        snapshot.set(name, [
          pageData1.meta.lastModified,
          pageData2.meta.lastModified,
        ]);
        return;
      }
    }
    const revisionFileName = filePieces.length === 1
      ? `${name}.conflicted.${pageData2.meta.lastModified}`
      : `${fileNameBase}.conflicted.${pageData2.meta.lastModified}.${fileNameExt}`;
    console.log(
      "Going to create conflicting copy",
      revisionFileName,
    );

    // Copy secondary to conflict copy
    const localConflictMeta = await primary.writeFile(
      revisionFileName,
      "arraybuffer",
      pageData2.data,
    );
    const remoteConflictMeta = await secondary.writeFile(
      revisionFileName,
      "arraybuffer",
      pageData2.data,
    );

    // Updating snapshot
    snapshot.set(revisionFileName, [
      localConflictMeta.lastModified,
      remoteConflictMeta.lastModified,
    ]);

    // Write replacement on top
    const writeMeta = await secondary.writeFile(
      name,
      "arraybuffer",
      pageData1.data,
      true,
    );

    snapshot.set(name, [pageData1.meta.lastModified, writeMeta.lastModified]);
  }

  syncCandidates(files: FileMeta[]): FileMeta[] {
    return files.filter((f) => !f.name.startsWith("_plug/"));
  }
}

import { renderToText, replaceNodesMatching } from "../../plug-api/lib/tree.ts";
import buildMarkdown from "../markdown_parser/parser.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import type { FileMeta } from "../types.ts";
import { SpacePrimitives } from "./space_primitives.ts";

type SyncHash = number;

// Tuple where the first value represents a lastModified timestamp for the primary space
// and the second item the lastModified value of the secondary space
export type SyncStatusItem = [SyncHash, SyncHash];

export interface Logger {
  log(level: string, ...messageBits: any[]): void;
}

class ConsoleLogger implements Logger {
  log(_level: string, ...messageBits: any[]) {
    console.log(...messageBits);
  }
}

// Implementation of this algorithm https://unterwaditzer.net/2016/sync-algorithm.html
export class SpaceSync {
  constructor(
    private primary: SpacePrimitives,
    private secondary: SpacePrimitives,
    readonly snapshot: Map<string, SyncStatusItem>,
    readonly logger: Logger = new ConsoleLogger(),
  ) {}

  async syncFiles(
    conflictResolver: (
      name: string,
      snapshot: Map<string, SyncStatusItem>,
      primarySpace: SpacePrimitives,
      secondarySpace: SpacePrimitives,
      logger: Logger,
    ) => Promise<number>,
  ): Promise<number> {
    let operations = 0;
    this.logger.log("info", "Fetching snapshot from primary");
    const primaryAllPages = this.syncCandidates(
      await this.primary.fetchFileList(),
    );

    this.logger.log("info", "Fetching snapshot from secondary");
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

      this.logger.log("info", "Iterating over all files");
      for (const name of allFilesToProcess) {
        operations += await this.syncFile(
          name,
          primaryFileMap.get(name),
          secondaryFileMap.get(name),
          conflictResolver,
        );
      }
    } catch (e: any) {
      this.logger.log("error", "Sync error:", e.message);
      throw e;
    }
    this.logger.log("info", "Sync complete, operations performed", operations);

    return operations;
  }

  async syncFile(
    name: string,
    primaryHash: SyncHash | undefined,
    secondaryHash: SyncHash | undefined,
    conflictResolver: (
      name: string,
      snapshot: Map<string, SyncStatusItem>,
      primarySpace: SpacePrimitives,
      secondarySpace: SpacePrimitives,
      logger: Logger,
    ) => Promise<number>,
  ): Promise<number> {
    let operations = 0;

    if (
      primaryHash && !secondaryHash &&
      !this.snapshot.has(name)
    ) {
      // New file, created on primary, copy from primary to secondary
      this.logger.log(
        "info",
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
        primaryHash,
        writtenMeta.lastModified,
      ]);
      operations++;
    } else if (
      secondaryHash && !primaryHash &&
      !this.snapshot.has(name)
    ) {
      // New file, created on secondary, copy from secondary to primary
      this.logger.log(
        "info",
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
        secondaryHash,
      ]);
      operations++;
    } else if (
      primaryHash && this.snapshot.has(name) &&
      !secondaryHash
    ) {
      // File deleted on B
      this.logger.log(
        "info",
        "File deleted on secondary, deleting from primary",
        name,
      );
      await this.primary.deleteFile(name);
      this.snapshot.delete(name);
      operations++;
    } else if (
      secondaryHash && this.snapshot.has(name) &&
      !primaryHash
    ) {
      // File deleted on A
      this.logger.log(
        "info",
        "File deleted on primary, deleting from secondary",
        name,
      );
      await this.secondary.deleteFile(name);
      this.snapshot.delete(name);
      operations++;
    } else if (
      this.snapshot.has(name) && !primaryHash &&
      !secondaryHash
    ) {
      // File deleted on both sides, :shrug:
      this.logger.log(
        "info",
        "File deleted on both ends, deleting from status",
        name,
      );
      this.snapshot.delete(name);
      operations++;
    } else if (
      primaryHash && secondaryHash &&
      this.snapshot.get(name) &&
      primaryHash !== this.snapshot.get(name)![0] &&
      secondaryHash === this.snapshot.get(name)![1]
    ) {
      // File has changed on primary, but not secondary: copy from primary to secondary
      this.logger.log(
        "info",
        "File changed on primary, copying to secondary",
        name,
      );
      const { data } = await this.primary.readFile(name, "arraybuffer");
      const writtenMeta = await this.secondary.writeFile(
        name,
        "arraybuffer",
        data,
      );
      this.snapshot.set(name, [
        primaryHash,
        writtenMeta.lastModified,
      ]);
      operations++;
    } else if (
      primaryHash && secondaryHash &&
      this.snapshot.get(name) &&
      secondaryHash !== this.snapshot.get(name)![1] &&
      primaryHash === this.snapshot.get(name)![0]
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
        secondaryHash,
      ]);
      operations++;
    } else if (
      ( // File changed on both ends, but we don't have any info in the snapshot (resync scenario?): have to run through conflict handling
        primaryHash && secondaryHash &&
        !this.snapshot.has(name)
      ) ||
      ( // File changed on both ends, CONFLICT!
        primaryHash && secondaryHash &&
        this.snapshot.get(name) &&
        secondaryHash !== this.snapshot.get(name)![1] &&
        primaryHash !== this.snapshot.get(name)![0]
      )
    ) {
      this.logger.log(
        "info",
        "File changed on both ends, potential conflict",
        name,
      );
      operations += await conflictResolver(
        name,
        this.snapshot,
        this.primary,
        this.secondary,
        this.logger,
      );
    } else {
      // Nothing needs to happen
    }
    return operations;
  }

  // Strategy: Primary wins
  public static async primaryConflictResolver(
    name: string,
    snapshot: Map<string, SyncStatusItem>,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
    logger: Logger,
  ): Promise<number> {
    logger.log("info", "Starting conflict resolution for", name);
    const filePieces = name.split(".");
    const fileNameBase = filePieces.slice(0, -1).join(".");
    const fileNameExt = filePieces[filePieces.length - 1];
    const pageData1 = await primary.readFile(name, "arraybuffer");
    const pageData2 = await secondary.readFile(name, "arraybuffer");

    if (name.endsWith(".md")) {
      logger.log("info", "File is markdown, using smart conflict resolution");
      // Let's use a smartert check for markdown files, ignoring directive bodies
      const pageText1 = removeDirectiveBody(
        new TextDecoder().decode(pageData1.data as Uint8Array),
      );
      const pageText2 = removeDirectiveBody(
        new TextDecoder().decode(pageData2.data as Uint8Array),
      );
      if (pageText1 === pageText2) {
        logger.log(
          "info",
          "Files are the same (eliminating the directive bodies), no conflict",
        );
        snapshot.set(name, [
          pageData1.meta.lastModified,
          pageData2.meta.lastModified,
        ]);
        return 0;
      }
    } else {
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
          logger.log("info", "Files are the same, no conflict");
          snapshot.set(name, [
            pageData1.meta.lastModified,
            pageData2.meta.lastModified,
          ]);
          return 0;
        }
      }
    }
    const revisionFileName = filePieces.length === 1
      ? `${name}.conflicted.${pageData2.meta.lastModified}`
      : `${fileNameBase}.conflicted.${pageData2.meta.lastModified}.${fileNameExt}`;
    logger.log(
      "info",
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
    return 1;
  }

  syncCandidates(files: FileMeta[]): FileMeta[] {
    return files.filter((f) => !f.name.startsWith("_plug/"));
  }
}

const markdownLanguage = buildMarkdown([]);

export function removeDirectiveBody(text: string): string {
  // Parse
  const tree = parse(markdownLanguage, text);
  // Remove bodies
  replaceNodesMatching(tree, (node) => {
    if (node.type === "DirectiveBody") {
      return null;
    }
  });
  // Turn back into text
  return renderToText(tree);
}

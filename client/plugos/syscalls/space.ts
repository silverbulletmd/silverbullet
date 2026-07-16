import { parseToRef, type Ref } from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "../../client.ts";
import type { SysCallMapping } from "../system.ts";

import type {
  DocumentMeta,
  FileMeta,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";

export function spaceReadSyscalls(client: Client): SysCallMapping {
  return {
    "space.listPages": {
      callback: (): Promise<PageMeta[]> => client.space.fetchPageList(),
      description: "Lists all pages in the space.",
    },
    "space.readPage": {
      callback: async (_ctx, name: string): Promise<string> =>
        (await client.space.readPage(name)).text,
      description: "Reads a page and returns its Markdown text.",
      signatures: ["space.readPage(name)"],
    },
    "space.readPageWithMeta": {
      callback: (
        _ctx,
        name: string,
      ): Promise<{ text: string; meta: PageMeta }> =>
        client.space.readPage(name),
      description:
        "Reads a page and returns both its Markdown text and metadata.",
      signatures: ["space.readPageWithMeta(name)"],
    },
    "space.readRef": {
      callback: async (_ctx, ref: string | Ref): Promise<string> => {
        if (typeof ref === "string") {
          ref = parseToRef(ref)!;
          if (!ref) {
            throw new Error(`Invalid ref: ${ref}`);
          }
        }
        return (await client.space.readRef(ref)).text;
      },
      description:
        "Reads the text addressed by a page, header, or position reference.",
      signatures: ["space.readRef(ref)"],
    },
    "space.pageExists": {
      callback: (_ctx, name: string): boolean =>
        client.clientSystem.allKnownFiles.has(`${name}.md`),
      description: "Checks whether a page exists in the space.",
      signatures: ["space.pageExists(name)"],
    },
    "space.getPageMeta": {
      callback: (_ctx, name: string): Promise<PageMeta> =>
        client.space.getPageMeta(name),
      description: "Returns metadata for a page.",
      signatures: ["space.getPageMeta(name)"],
    },
    "space.listPlugs": {
      callback: (): Promise<FileMeta[]> => client.space.listPlugs(),
      description: "Lists all plug files in the space.",
    },
    "space.listDocuments": {
      callback: async (): Promise<DocumentMeta[]> =>
        await client.space.fetchDocumentList(),
      description: "Lists all non-page documents in the space.",
    },
    "space.readDocument": {
      callback: async (_ctx, name: string): Promise<Uint8Array> =>
        (await client.space.readDocument(name)).data,
      description: "Reads a document as binary data.",
      signatures: ["space.readDocument(name)"],
    },
    "space.getDocumentMeta": {
      callback: async (_ctx, name: string): Promise<DocumentMeta> =>
        await client.space.getDocumentMeta(name),
      description: "Returns metadata for a document.",
      signatures: ["space.getDocumentMeta(name)"],
    },
    // DEPRECATED, please use document versions instead, left here for backwards compatibility
    "space.listAttachments": {
      callback: async (): Promise<DocumentMeta[]> =>
        await client.space.fetchDocumentList(),
      description: "Deprecated alias for space.listDocuments.",
      deprecated: "Use space.listDocuments instead.",
    },
    "space.readAttachment": {
      callback: async (_ctx, name: string): Promise<Uint8Array> =>
        (await client.space.readDocument(name)).data,
      description: "Deprecated alias for space.readDocument.",
      deprecated: "Use space.readDocument instead.",
      signatures: ["space.readAttachment(name)"],
    },
    "space.getAttachmentMeta": {
      callback: async (_ctx, name: string): Promise<DocumentMeta> =>
        await client.space.getDocumentMeta(name),
      description: "Deprecated alias for space.getDocumentMeta.",
      deprecated: "Use space.getDocumentMeta instead.",
      signatures: ["space.getAttachmentMeta(name)"],
    },
    // FS
    "space.listFiles": {
      callback: (): Promise<FileMeta[]> =>
        client.space.spacePrimitives.fetchFileList(),
      description: "Lists every file in the space.",
    },
    "space.getFileMeta": {
      callback: (_ctx, name: string): Promise<FileMeta> =>
        client.space.spacePrimitives.getFileMeta(name),
      description: "Returns metadata for an arbitrary space file.",
      signatures: ["space.getFileMeta(name)"],
    },
    "space.readFile": {
      callback: async (_ctx, name: string): Promise<Uint8Array> =>
        (await client.space.spacePrimitives.readFile(name)).data,
      description: "Reads an arbitrary space file as binary data.",
      signatures: ["space.readFile(name)"],
    },
    "space.readFileWithMeta": {
      callback: async (
        _ctx,
        name: string,
      ): Promise<{ data: Uint8Array; meta: FileMeta }> =>
        await client.space.spacePrimitives.readFile(name),
      description: "Reads an arbitrary space file together with its metadata.",
      signatures: ["space.readFileWithMeta(name)"],
    },
    "space.fileExists": {
      callback: async (_ctx, name: string): Promise<boolean> => {
        // If a full sync has successfully completed (so we know what files exist)
        // and we have a snapshot, let's use the snapshot
        if (
          client.fullSyncCompleted &&
          !client.eventedSpacePrimitives.isSnapshotEmpty()
        ) {
          return !!client.eventedSpacePrimitives.getSnapshot()[name];
        }
        try {
          await client.space.spacePrimitives.getFileMeta(name);
          // If this returned the file exists
          return true;
        } catch {
          // Assumption: any error means the file does not exist
          return false;
        }
      },
      description: "Checks whether an arbitrary file exists in the space.",
      signatures: ["space.fileExists(name)"],
    },
  };
}

export function spaceWriteSyscalls(editor: Client): SysCallMapping {
  return {
    "space.writePage": {
      callback: (_ctx, name: string, text: string): Promise<PageMeta> =>
        editor.space.writePage(name, text),
      description: "Writes Markdown text to a page and returns its metadata.",
      signatures: ["space.writePage(name, text)"],
    },
    "space.deletePage": {
      callback: async (_ctx, name: string) => {
        console.log("Deleting page");
        await editor.space.deletePage(name);
      },
      description: "Deletes a page from the space.",
      signatures: ["space.deletePage(name)"],
    },
    "space.writeDocument": {
      callback: (_ctx, name: string, data: Uint8Array): Promise<DocumentMeta> =>
        editor.space.writeDocument(name, data),
      description: "Writes binary document data and returns its metadata.",
      signatures: ["space.writeDocument(name, data)"],
    },
    "space.deleteDocument": {
      callback: async (_ctx, name: string) => {
        await editor.space.deleteDocument(name);
      },
      description: "Deletes a document from the space.",
      signatures: ["space.deleteDocument(name)"],
    },
    "space.writeFile": {
      callback: (_ctx, name: string, data: Uint8Array): Promise<FileMeta> =>
        editor.space.spacePrimitives.writeFile(name, data),
      description: "Writes an arbitrary binary file and returns its metadata.",
      signatures: ["space.writeFile(name, data)"],
    },
    "space.deleteFile": {
      callback: (_ctx, name: string) =>
        editor.space.spacePrimitives.deleteFile(name),
      description: "Deletes an arbitrary file from the space.",
      signatures: ["space.deleteFile(name)"],
    },
  };
}

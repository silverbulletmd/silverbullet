import type { Client } from "../client.ts";
import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type {
  AttachmentMeta,
  FileMeta,
  PageMeta,
} from "../../plug-api/types.ts";

export function spaceReadSyscalls(editor: Client): SysCallMapping {
  return {
    "space.listPages": (): Promise<PageMeta[]> => {
      return editor.space.fetchPageList();
    },
    "space.readPage": async (_ctx, name: string): Promise<string> => {
      return (await editor.space.readPage(name)).text;
    },
    "space.getPageMeta": (_ctx, name: string): Promise<PageMeta> => {
      return editor.space.getPageMeta(name);
    },
    "space.listPlugs": (): Promise<FileMeta[]> => {
      return editor.space.listPlugs();
    },
    "space.listAttachments": async (): Promise<AttachmentMeta[]> => {
      return await editor.space.fetchAttachmentList();
    },
    "space.readAttachment": async (_ctx, name: string): Promise<Uint8Array> => {
      return (await editor.space.readAttachment(name)).data;
    },
    "space.getAttachmentMeta": async (
      _ctx,
      name: string,
    ): Promise<AttachmentMeta> => {
      return await editor.space.getAttachmentMeta(name);
    },
    // FS
    "space.listFiles": (): Promise<FileMeta[]> => {
      return editor.space.spacePrimitives.fetchFileList();
    },
    "space.getFileMeta": (_ctx, name: string): Promise<FileMeta> => {
      return editor.space.spacePrimitives.getFileMeta(name);
    },
    "space.readFile": async (_ctx, name: string): Promise<Uint8Array> => {
      return (await editor.space.spacePrimitives.readFile(name)).data;
    },
  };
}

export function spaceWriteSyscalls(editor: Client): SysCallMapping {
  return {
    "space.writePage": (
      _ctx,
      name: string,
      text: string,
    ): Promise<PageMeta> => {
      return editor.space.writePage(name, text);
    },
    "space.deletePage": async (_ctx, name: string) => {
      // If we're deleting the current page, navigate to the index page
      if (editor.currentPage === name) {
        await editor.navigate({ page: "" });
      }
      // Remove page from open pages in editor
      // editor.openPages.openPages.delete(name);
      console.log("Deleting page");
      await editor.space.deletePage(name);
    },
    "space.writeAttachment": (
      _ctx,
      name: string,
      data: Uint8Array,
    ): Promise<AttachmentMeta> => {
      return editor.space.writeAttachment(name, data);
    },
    "space.deleteAttachment": async (_ctx, name: string) => {
      await editor.space.deleteAttachment(name);
    },
    "space.writeFile": (
      _ctx,
      name: string,
      data: Uint8Array,
    ): Promise<FileMeta> => {
      return editor.space.spacePrimitives.writeFile(name, data);
    },
    "space.deleteFile": (_ctx, name: string) => {
      return editor.space.spacePrimitives.deleteFile(name);
    },
  };
}

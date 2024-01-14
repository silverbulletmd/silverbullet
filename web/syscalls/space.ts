import { Client } from "../client.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { AttachmentMeta, FileMeta, PageMeta } from "$sb/types.ts";

export function spaceSyscalls(editor: Client): SysCallMapping {
  return {
    "space.listPages": (): Promise<PageMeta[]> => {
      return editor.space.fetchPageList();
    },
    "space.readPage": async (
      name: string,
    ): Promise<string> => {
      return (await editor.space.readPage(name)).text;
    },
    "space.getPageMeta": (name: string): Promise<PageMeta> => {
      return editor.space.getPageMeta(name);
    },
    "space.writePage": (
      name: string,
      text: string,
    ): Promise<PageMeta> => {
      return editor.space.writePage(name, text);
    },
    "space.deletePage": async (name: string) => {
      // If we're deleting the current page, navigate to the index page
      if (editor.currentPage === name) {
        await editor.navigate("");
      }
      // Remove page from open pages in editor
      editor.openPages.openPages.delete(name);
      console.log("Deleting page");
      await editor.space.deletePage(name);
    },
    "space.listPlugs": (): Promise<FileMeta[]> => {
      return editor.space.listPlugs();
    },
    "space.listAttachments": async (): Promise<AttachmentMeta[]> => {
      return await editor.space.fetchAttachmentList();
    },
    "space.readAttachment": async (
      name: string,
    ): Promise<Uint8Array> => {
      return (await editor.space.readAttachment(name)).data;
    },
    "space.getAttachmentMeta": async (
      name: string,
    ): Promise<AttachmentMeta> => {
      return await editor.space.getAttachmentMeta(name);
    },
    "space.writeAttachment": (
      name: string,
      data: Uint8Array,
    ): Promise<AttachmentMeta> => {
      return editor.space.writeAttachment(name, data);
    },
    "space.deleteAttachment": async (name: string) => {
      await editor.space.deleteAttachment(name);
    },

    // FS
    "space.listFiles": (): Promise<FileMeta[]> => {
      return editor.space.spacePrimitives.fetchFileList();
    },
    "space.getFileMeta": (name: string): Promise<FileMeta> => {
      return editor.space.spacePrimitives.getFileMeta(name);
    },
    "space.readFile": async (name: string): Promise<Uint8Array> => {
      return (await editor.space.spacePrimitives.readFile(name)).data;
    },
    "space.writeFile": (
      name: string,
      data: Uint8Array,
    ): Promise<FileMeta> => {
      return editor.space.spacePrimitives.writeFile(name, data);
    },
    "space.deleteFile": (name: string) => {
      return editor.space.spacePrimitives.deleteFile(name);
    },
  };
}

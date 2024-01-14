import { AttachmentMeta, FileMeta, PageMeta } from "$sb/types.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import type { Space } from "../../web/space.ts";

/**
 * Almost the same as web/syscalls/space.ts except leaving out client-specific stuff
 */
export function spaceSyscalls(space: Space): SysCallMapping {
  return {
    "space.listPages": (): Promise<PageMeta[]> => {
      return space.fetchPageList();
    },
    "space.readPage": async (
      name: string,
    ): Promise<string> => {
      return (await space.readPage(name)).text;
    },
    "space.getPageMeta": (name: string): Promise<PageMeta> => {
      return space.getPageMeta(name);
    },
    "space.writePage": (
      name: string,
      text: string,
    ): Promise<PageMeta> => {
      return space.writePage(name, text);
    },
    "space.deletePage": async (name: string) => {
      await space.deletePage(name);
    },
    "space.listPlugs": (): Promise<FileMeta[]> => {
      return space.listPlugs();
    },
    "space.listAttachments": async (): Promise<AttachmentMeta[]> => {
      return await space.fetchAttachmentList();
    },
    "space.readAttachment": async (
      name: string,
    ): Promise<Uint8Array> => {
      return (await space.readAttachment(name)).data;
    },
    "space.getAttachmentMeta": async (
      name: string,
    ): Promise<AttachmentMeta> => {
      return await space.getAttachmentMeta(name);
    },
    "space.writeAttachment": (
      name: string,
      data: Uint8Array,
    ): Promise<AttachmentMeta> => {
      return space.writeAttachment(name, data);
    },
    "space.deleteAttachment": async (name: string) => {
      await space.deleteAttachment(name);
    },

    // FS
    "space.listFiles": (): Promise<FileMeta[]> => {
      return space.spacePrimitives.fetchFileList();
    },
    "space.getFileMeta": (name: string): Promise<FileMeta> => {
      return space.spacePrimitives.getFileMeta(name);
    },
    "space.readFile": async (name: string): Promise<Uint8Array> => {
      return (await space.spacePrimitives.readFile(name)).data;
    },
    "space.writeFile": (
      name: string,
      data: Uint8Array,
    ): Promise<FileMeta> => {
      return space.spacePrimitives.writeFile(name, data);
    },
    "space.deleteFile": (name: string) => {
      return space.spacePrimitives.deleteFile(name);
    },
  };
}

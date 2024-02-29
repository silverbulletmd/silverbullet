import { AttachmentMeta, FileMeta, PageMeta } from "../../plug-api/types.ts";
import { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Space } from "../../common/space.ts";

/**
 * Almost the same as web/syscalls/space.ts except leaving out client-specific stuff
 */
export function spaceReadSyscalls(space: Space): SysCallMapping {
  return {
    "space.listPages": (): Promise<PageMeta[]> => {
      return space.fetchPageList();
    },
    "space.readPage": async (_ctx, name: string): Promise<string> => {
      return (await space.readPage(name)).text;
    },
    "space.getPageMeta": (_ctx, name: string): Promise<PageMeta> => {
      return space.getPageMeta(name);
    },
    "space.listPlugs": (): Promise<FileMeta[]> => {
      return space.listPlugs();
    },
    "space.listAttachments": async (): Promise<AttachmentMeta[]> => {
      return await space.fetchAttachmentList();
    },
    "space.readAttachment": async (_ctx, name: string): Promise<Uint8Array> => {
      return (await space.readAttachment(name)).data;
    },
    "space.getAttachmentMeta": async (
      _ctx,
      name: string,
    ): Promise<AttachmentMeta> => {
      return await space.getAttachmentMeta(name);
    },

    // FS
    "space.listFiles": (): Promise<FileMeta[]> => {
      return space.spacePrimitives.fetchFileList();
    },
    "space.getFileMeta": (_ctx, name: string): Promise<FileMeta> => {
      return space.spacePrimitives.getFileMeta(name);
    },
    "space.readFile": async (_ctx, name: string): Promise<Uint8Array> => {
      return (await space.spacePrimitives.readFile(name)).data;
    },
  };
}

export function spaceWriteSyscalls(space: Space): SysCallMapping {
  return {
    "space.writePage": (
      _ctx,
      name: string,
      text: string,
    ): Promise<PageMeta> => {
      return space.writePage(name, text);
    },
    "space.deletePage": async (_ctx, name: string) => {
      await space.deletePage(name);
    },
    "space.writeAttachment": (
      _ctx,
      name: string,
      data: Uint8Array,
    ): Promise<AttachmentMeta> => {
      return space.writeAttachment(name, data);
    },
    "space.deleteAttachment": async (_ctx, name: string) => {
      await space.deleteAttachment(name);
    },
    "space.writeFile": (
      _ctx,
      name: string,
      data: Uint8Array,
    ): Promise<FileMeta> => {
      return space.spacePrimitives.writeFile(name, data);
    },
    "space.deleteFile": (_ctx, name: string) => {
      return space.spacePrimitives.deleteFile(name);
    },
  };
}

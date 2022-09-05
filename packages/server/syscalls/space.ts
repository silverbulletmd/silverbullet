import { AttachmentMeta, PageMeta } from "@silverbulletmd/common/types";
import { SysCallMapping } from "@plugos/plugos/system";
import { Space } from "@silverbulletmd/common/spaces/space";

export default (space: Space): SysCallMapping => {
  return {
    "space.listPages": async (ctx, unfiltered = false): Promise<PageMeta[]> => {
      return [...space.listPages(unfiltered)];
    },
    "space.readPage": async (
      ctx,
      name: string
    ): Promise<{ text: string; meta: PageMeta }> => {
      return space.readPage(name);
    },
    "space.getPageMeta": async (ctx, name: string): Promise<PageMeta> => {
      return space.getPageMeta(name);
    },
    "space.writePage": async (
      ctx,
      name: string,
      text: string
    ): Promise<PageMeta> => {
      return space.writePage(name, text);
    },
    "space.deletePage": async (ctx, name: string) => {
      return space.deletePage(name);
    },
    "space.listAttachments": async (ctx): Promise<AttachmentMeta[]> => {
      return [...(await space.fetchAttachmentList()).attachments];
    },
    "space.readAttachment": async (
      ctx,
      name: string
    ): Promise<{ buffer: ArrayBuffer; meta: AttachmentMeta }> => {
      return await space.readAttachment(name);
    },
    "space.getAttachmentMeta": async (
      ctx,
      name: string
    ): Promise<AttachmentMeta> => {
      return await space.getAttachmentMeta(name);
    },
    "space.writeAttachment": async (
      ctx,
      name: string,
      buffer: ArrayBuffer
    ): Promise<AttachmentMeta> => {
      return await space.writeAttachment(name, buffer);
    },
    "space.deleteAttachment": async (ctx, name: string) => {
      await space.deleteAttachment(name);
    },
  };
};

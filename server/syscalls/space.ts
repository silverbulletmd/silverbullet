import { AttachmentMeta, PageMeta } from "../../common/types.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { Space } from "../../common/spaces/space.ts";
import {
  FileData,
  FileEncoding,
} from "../../common/spaces/space_primitives.ts";

export default (space: Space): SysCallMapping => {
  return {
    "space.listPages": async (): Promise<PageMeta[]> => {
      return [...space.listPages()];
    },
    "space.readPage": async (
      ctx,
      name: string,
    ): Promise<{ text: string; meta: PageMeta }> => {
      return space.readPage(name);
    },
    "space.getPageMeta": async (ctx, name: string): Promise<PageMeta> => {
      return space.getPageMeta(name);
    },
    "space.writePage": async (
      ctx,
      name: string,
      text: string,
    ): Promise<PageMeta> => {
      return space.writePage(name, text);
    },
    "space.deletePage": async (ctx, name: string) => {
      return space.deletePage(name);
    },
    "space.listPlugs": async (): Promise<string[]> => {
      return await space.listPlugs();
    },
    "space.listAttachments": async (ctx): Promise<AttachmentMeta[]> => {
      return await space.fetchAttachmentList();
    },
    "space.readAttachment": async (
      ctx,
      name: string,
    ): Promise<{ data: FileData; meta: AttachmentMeta }> => {
      return await space.readAttachment(name, "dataurl");
    },
    "space.getAttachmentMeta": async (
      ctx,
      name: string,
    ): Promise<AttachmentMeta> => {
      return await space.getAttachmentMeta(name);
    },
    "space.writeAttachment": async (
      ctx,
      name: string,
      encoding: FileEncoding,
      data: string,
    ): Promise<AttachmentMeta> => {
      return await space.writeAttachment(name, encoding, data);
    },
    "space.deleteAttachment": async (ctx, name: string) => {
      await space.deleteAttachment(name);
    },
  };
};

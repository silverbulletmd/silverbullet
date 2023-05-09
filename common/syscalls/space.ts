import { AttachmentMeta, PageMeta } from "../../common/types.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { Space } from "../../common/spaces/space.ts";
import {
  FileData,
  FileEncoding,
} from "../../common/spaces/space_primitives.ts";

import { FileMeta as PlugFileMeta } from "../../plug-api/plugos-syscall/types.ts";

export default (space: Space): SysCallMapping => {
  return {
    "space.listPages": (): Promise<PageMeta[]> => {
      return space.fetchPageList();
    },
    "space.readPage": async (
      _ctx,
      name: string,
    ): Promise<string> => {
      return (await space.readPage(name)).text;
    },
    "space.getPageMeta": (_ctx, name: string): Promise<PageMeta> => {
      return space.getPageMeta(name);
    },
    "space.writePage": (
      _ctx,
      name: string,
      text: string,
    ): Promise<PageMeta> => {
      return space.writePage(name, text);
    },
    "space.deletePage": (_ctx, name: string) => {
      return space.deletePage(name);
    },
    "space.listPlugs": (): Promise<string[]> => {
      return space.listPlugs();
    },
    "space.listAttachments": async (): Promise<AttachmentMeta[]> => {
      return await space.fetchAttachmentList();
    },
    "space.readAttachment": async (
      _ctx,
      name: string,
    ): Promise<FileData> => {
      return (await space.readAttachment(name, "dataurl")).data;
    },
    "space.getAttachmentMeta": async (
      _ctx,
      name: string,
    ): Promise<AttachmentMeta> => {
      return await space.getAttachmentMeta(name);
    },
    "space.writeAttachment": async (
      _ctx,
      name: string,
      encoding: FileEncoding,
      data: string,
    ): Promise<AttachmentMeta> => {
      return await space.writeAttachment(name, encoding, data);
    },
    "space.deleteAttachment": async (_ctx, name: string) => {
      await space.deleteAttachment(name);
    },

    "space.listFiles": (_ctx, path: string): Promise<PlugFileMeta[]> => {
      return space.listFiles(path);
    },
  };
};

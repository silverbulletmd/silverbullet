import { Editor } from "../editor";
import { SysCallMapping } from "@plugos/plugos/system";
import { AttachmentMeta, PageMeta } from "@silverbulletmd/common/types";
import {
  FileData,
  FileEncoding,
} from "@silverbulletmd/common/spaces/space_primitives";

export function spaceSyscalls(editor: Editor): SysCallMapping {
  return {
    "space.listPages": async (): Promise<PageMeta[]> => {
      return [...editor.space.listPages()];
    },
    "space.readPage": async (
      ctx,
      name: string
    ): Promise<{ text: string; meta: PageMeta }> => {
      return await editor.space.readPage(name);
    },
    "space.getPageMeta": async (ctx, name: string): Promise<PageMeta> => {
      return await editor.space.getPageMeta(name);
    },
    "space.writePage": async (
      ctx,
      name: string,
      text: string
    ): Promise<PageMeta> => {
      return await editor.space.writePage(name, text);
    },
    "space.deletePage": async (ctx, name: string) => {
      // If we're deleting the current page, navigate to the index page
      if (editor.currentPage === name) {
        await editor.navigate("");
      }
      // Remove page from open pages in editor
      editor.openPages.delete(name);
      console.log("Deleting page");
      await editor.space.deletePage(name);
    },
    "space.listPlugs": async (): Promise<string[]> => {
      return await editor.space.listPlugs();
    },
    "space.listAttachments": async (ctx): Promise<AttachmentMeta[]> => {
      return await editor.space.fetchAttachmentList();
    },
    "space.readAttachment": async (
      ctx,
      name: string
    ): Promise<{ data: FileData; meta: AttachmentMeta }> => {
      return await editor.space.readAttachment(name, "dataurl");
    },
    "space.getAttachmentMeta": async (
      ctx,
      name: string
    ): Promise<AttachmentMeta> => {
      return await editor.space.getAttachmentMeta(name);
    },
    "space.writeAttachment": async (
      ctx,
      name: string,
      encoding: FileEncoding,
      data: FileData
    ): Promise<AttachmentMeta> => {
      return await editor.space.writeAttachment(name, encoding, data);
    },
    "space.deleteAttachment": async (ctx, name: string) => {
      await editor.space.deleteAttachment(name);
    },
  };
}

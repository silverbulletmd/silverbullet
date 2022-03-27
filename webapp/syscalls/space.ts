import { Editor } from "../editor";
import { PageMeta } from "../types";
import { SysCallMapping } from "../../plugos/system";

export default (editor: Editor): SysCallMapping => ({
  listPages: (): PageMeta[] => {
    return [...editor.viewState.allPages];
  },
  readPage: async (
    ctx,
    name: string
  ): Promise<{ text: string; meta: PageMeta }> => {
    return await editor.space.readPage(name);
  },
  writePage: async (ctx, name: string, text: string): Promise<PageMeta> => {
    return await editor.space.writePage(name, text);
  },
  deletePage: async (ctx, name: string) => {
    // If we're deleting the current page, navigate to the start page
    if (editor.currentPage === name) {
      await editor.navigate("start");
    }
    // Remove page from open pages in editor
    editor.openPages.delete(name);
    console.log("Deleting page");
    await editor.space.deletePage(name);
  },
});

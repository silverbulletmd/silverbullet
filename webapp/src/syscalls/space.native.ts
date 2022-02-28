import { Editor } from "../editor";
import { PageMeta } from "../types";

export default (editor: Editor) => ({
  "space.listPages": (): PageMeta[] => {
    return editor.viewState.allPages;
  },
  "space.reloadPageList": async () => {
    await editor.loadPageList();
  },
  "space.reindex": async () => {
    await editor.indexer.reindexSpace(editor.space, editor);
  },
  "space.readPage": async (
    name: string
  ): Promise<{ text: string; meta: PageMeta }> => {
    return await editor.space.readPage(name);
  },
  "space.writePage": async (name: string, text: string): Promise<PageMeta> => {
    return await editor.space.writePage(name, text);
  },
  "space.deletePage": async (name: string) => {
    console.log("Clearing page index", name);
    await editor.indexer.clearPageIndexForPage(name);
    // If we're deleting the current page, navigate to the start page
    if (editor.currentPage?.name === name) {
      await editor.navigate("start");
    }
    // Remove page from open pages in editor
    editor.openPages.delete(name);
    console.log("Deleting page");
    await editor.space.deletePage(name);
  },
});

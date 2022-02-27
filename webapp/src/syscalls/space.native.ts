import { Editor } from "../editor";
import { PageMeta } from "../types";

export default (editor: Editor) => ({
  "space.listPages": (): PageMeta[] => {
    return editor.viewState.allPages;
  },
  "space.readPage": async (
    name: string
  ): Promise<{ text: string; meta: PageMeta }> => {
    return await editor.fs.readPage(name);
  },
  "space.writePage": async (name: string, text: string): Promise<PageMeta> => {
    return await editor.fs.writePage(name, text);
  },
});

import { Editor } from "../editor";
import { SyscallContext } from "../plugins/runtime";
import { PageMeta } from "../types";

export default (editor: Editor) => ({
  "space.listPages": (ctx: SyscallContext): PageMeta[] => {
    return editor.viewState.allPages;
  },
  "space.readPage": async (
    ctx: SyscallContext,
    name: string
  ): Promise<{ text: string; meta: PageMeta }> => {
    return await editor.fs.readPage(name);
  },
  "space.writePage": async (
    ctx: SyscallContext,
    name: string,
    text: string
  ): Promise<PageMeta> => {
    return await editor.fs.writePage(name, text);
  },
});

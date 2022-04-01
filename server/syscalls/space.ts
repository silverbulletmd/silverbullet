import { PageMeta } from "../../common/types";
import { SysCallMapping } from "../../plugos/system";
import { Storage } from "../disk_storage";

export default (storage: Storage): SysCallMapping => {
  return {
    listPages: (ctx): Promise<PageMeta[]> => {
      return storage.listPages();
    },
    readPage: async (
      ctx,
      name: string
    ): Promise<{ text: string; meta: PageMeta }> => {
      return storage.readPage(name);
    },
    writePage: async (ctx, name: string, text: string): Promise<PageMeta> => {
      return storage.writePage(name, text);
    },
    deletePage: async (ctx, name: string) => {
      return storage.deletePage(name);
    },
  };
};

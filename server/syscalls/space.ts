import {PageMeta} from "../../common/types";
import {SysCallMapping} from "../../plugos/system";
import {Storage} from "../disk_storage";

export default (storage: Storage): SysCallMapping => {
  return {
    "space.listPages": (ctx): Promise<PageMeta[]> => {
      return storage.listPages();
    },
    "space.readPage": async (
      ctx,
      name: string
    ): Promise<{ text: string; meta: PageMeta }> => {
      return storage.readPage(name);
    },
    "space.writePage": async (
      ctx,
      name: string,
      text: string
    ): Promise<PageMeta> => {
      return storage.writePage(name, text);
    },
    "space.deletePage": async (ctx, name: string) => {
      return storage.deletePage(name);
    },
  };
};

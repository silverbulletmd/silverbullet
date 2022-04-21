import { PageMeta } from "../../common/types";
import { SysCallMapping } from "../../plugos/system";
import { Space } from "../../common/spaces/space";

export default (space: Space): SysCallMapping => {
  return {
    "space.listPages": async (ctx): Promise<PageMeta[]> => {
      return [...space.listPages()];
    },
    "space.readPage": async (
      ctx,
      name: string
    ): Promise<{ text: string; meta: PageMeta }> => {
      return space.readPage(name);
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
  };
};

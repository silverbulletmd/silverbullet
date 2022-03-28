import { PageMeta } from "../types";
import { SysCallMapping } from "../../plugos/system";
import { PageApi } from "../page_api";
import { ClientConnection } from "../api_server";

export default (pageApi: PageApi): SysCallMapping => {
  const api = pageApi.api();
  // @ts-ignore
  const dummyConn = new ClientConnection(null);
  return {
    listPages: (ctx): Promise<PageMeta[]> => {
      return api.listPages(dummyConn);
    },
    readPage: async (
      ctx,
      name: string
    ): Promise<{ text: string; meta: PageMeta }> => {
      return api.readPage(dummyConn, name);
    },
    writePage: async (ctx, name: string, text: string): Promise<PageMeta> => {
      return api.writePage(dummyConn, name, text);
    },
    deletePage: async (ctx, name: string) => {
      return api.deletePage(dummyConn, name);
    },
  };
};

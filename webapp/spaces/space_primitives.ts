import { Plug } from "../../plugos/plug";
import { PageMeta } from "../../common/types";

export interface SpacePrimitives {
  // Pages
  fetchPageList(): Promise<{ pages: Set<PageMeta>; nowTimestamp: number }>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  getPageMeta(name: string): Promise<PageMeta>;
  writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;

  // Plugs
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any>;
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any>;
}

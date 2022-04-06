import { Manifest } from "../../common/manifest";
import { Plug } from "../../plugos/plug";
import { PageMeta } from "../../common/types";

export type SpaceEvents = {
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: Set<PageMeta>) => void;
  plugLoaded: (plugName: string, plug: Manifest) => void;
  plugUnloaded: (plugName: string) => void;
};

export interface Space {
  // Pages
  fetchPageList(): Promise<Set<PageMeta>>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  getPageMeta(name: string): Promise<PageMeta>;
  writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta>;
  deletePage(name: string, deleteDate?: number): Promise<void>;

  // Plugs
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any>;
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any>;
}

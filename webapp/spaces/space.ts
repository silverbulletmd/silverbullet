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

export type PlugMeta = {
  name: string;
  version: number;
};

export interface Space {
  // Pages
  watchPage(pageName: string): void;
  unwatchPage(pageName: string): void;
  listPages(): Promise<Set<PageMeta>>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  getPageMeta(name: string): Promise<PageMeta>;
  writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    withMeta?: PageMeta
  ): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;

  // Plugs
  listPlugs(): Promise<PlugMeta[]>;
  loadPlug(name: string): Promise<Manifest>;
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any>;
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any>;

  // Events
  on(handlers: Partial<SpaceEvents>): void;
  off(handlers: Partial<SpaceEvents>): void;
  emit(eventName: keyof SpaceEvents, ...args: any[]): void;

  // TODO: Get rid of this
  updatePageListAsync(): void;
}

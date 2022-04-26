import { SpacePrimitives } from "./space_primitives";
import { EventHook } from "@plugos/plugos/hooks/event";
import { PageMeta } from "../types";
import { Plug } from "@plugos/plugos/plug";
import { plugPrefix, trashPrefix } from "./constants";

export class EventedSpacePrimitives implements SpacePrimitives {
  constructor(private wrapped: SpacePrimitives, private eventHook: EventHook) {}

  fetchPageList(): Promise<{ pages: Set<PageMeta>; nowTimestamp: number }> {
    return this.wrapped.fetchPageList();
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return this.wrapped.proxySyscall(plug, name, args);
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any> {
    return this.wrapped.invokeFunction(plug, env, name, args);
  }

  readPage(pageName: string): Promise<{ text: string; meta: PageMeta }> {
    return this.wrapped.readPage(pageName);
  }

  async writePage(
    pageName: string,
    text: string,
    selfUpdate: boolean,
    lastModified?: number
  ): Promise<PageMeta> {
    const newPageMeta = await this.wrapped.writePage(
      pageName,
      text,
      selfUpdate,
      lastModified
    );
    // This can happen async
    if (!pageName.startsWith(trashPrefix) && !pageName.startsWith(plugPrefix)) {
      this.eventHook
        .dispatchEvent("page:saved", pageName)
        .then(() => {
          return this.eventHook.dispatchEvent("page:index_text", {
            name: pageName,
            text,
          });
        })
        .catch((e) => {
          console.error("Error dispatching page:saved event", e);
        });
    }
    return newPageMeta;
  }

  getPageMeta(pageName: string): Promise<PageMeta> {
    return this.wrapped.getPageMeta(pageName);
  }

  async deletePage(pageName: string): Promise<void> {
    await this.eventHook.dispatchEvent("page:deleted", pageName);
    return this.wrapped.deletePage(pageName);
  }
}

import { EventHook } from "@plugos/plugos/hooks/event";
import { Plug } from "@plugos/plugos/plug";

import { AttachmentMeta, PageMeta } from "../types";
import { plugPrefix, trashPrefix } from "./constants";
import { SpacePrimitives } from "./space_primitives";

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

  fetchAttachmentList(): Promise<{
    attachments: Set<AttachmentMeta>;
    nowTimestamp: number;
  }> {
    return this.wrapped.fetchAttachmentList();
  }

  readAttachment(
    name: string
  ): Promise<{ buffer: ArrayBuffer; meta: AttachmentMeta }> {
    return this.wrapped.readAttachment(name);
  }

  getAttachmentMeta(name: string): Promise<AttachmentMeta> {
    return this.wrapped.getAttachmentMeta(name);
  }

  async writeAttachment(
    name: string,
    blob: ArrayBuffer,
    selfUpdate?: boolean | undefined,
    lastModified?: number | undefined
  ): Promise<AttachmentMeta> {
    let meta = await this.wrapped.writeAttachment(
      name,
      blob,
      selfUpdate,
      lastModified
    );
    await this.eventHook.dispatchEvent("attachment:saved", name);
    return meta;
  }

  async deleteAttachment(name: string): Promise<void> {
    await this.eventHook.dispatchEvent("attachment:deleted", name);
    return this.wrapped.deleteAttachment(name);
  }
}

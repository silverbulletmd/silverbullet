import { Plug } from "@plugos/plugos/plug";
import { SpacePrimitives } from "@silverbulletmd/common/spaces/space_primitives";
import { AttachmentMeta, PageMeta } from "@silverbulletmd/common/types";
import { PageNamespaceHook, PageNamespaceOperation } from "./page_namespace";

export class PlugSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private hook: PageNamespaceHook
  ) {}

  performOperation(
    type: PageNamespaceOperation,
    pageName: string,
    ...args: any[]
  ): Promise<any> | false {
    for (let { operation, pattern, plug, name } of this.hook.spaceFunctions) {
      if (operation === type && pageName.match(pattern)) {
        return plug.invoke(name, [pageName, ...args]);
      }
    }
    return false;
  }

  async fetchPageList(): Promise<{
    pages: Set<PageMeta>;
    nowTimestamp: number;
  }> {
    let allPages = new Set<PageMeta>();
    for (let { plug, name, operation } of this.hook.spaceFunctions) {
      if (operation === "listPages") {
        try {
          for (let pm of await plug.invoke(name, [])) {
            allPages.add(pm);
          }
        } catch (e) {
          console.error("Error listing pages", e);
        }
      }
    }
    let result = await this.wrapped.fetchPageList();
    for (let pm of result.pages) {
      allPages.add(pm);
    }
    return {
      nowTimestamp: result.nowTimestamp,
      pages: allPages,
    };
  }

  readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    let result = this.performOperation("readPage", name);
    if (result) {
      return result;
    }
    return this.wrapped.readPage(name);
  }

  getPageMeta(name: string): Promise<PageMeta> {
    let result = this.performOperation("getPageMeta", name);
    if (result) {
      return result;
    }
    return this.wrapped.getPageMeta(name);
  }

  writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta> {
    let result = this.performOperation(
      "writePage",
      name,
      text,
      selfUpdate,
      lastModified
    );
    if (result) {
      return result;
    }

    return this.wrapped.writePage(name, text, selfUpdate, lastModified);
  }

  deletePage(name: string): Promise<void> {
    let result = this.performOperation("deletePage", name);
    if (result) {
      return result;
    }
    return this.wrapped.deletePage(name);
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
  writeAttachment(
    name: string,
    blob: ArrayBuffer,
    selfUpdate?: boolean | undefined,
    lastModified?: number | undefined
  ): Promise<AttachmentMeta> {
    return this.wrapped.writeAttachment(name, blob, selfUpdate, lastModified);
  }
  deleteAttachment(name: string): Promise<void> {
    return this.wrapped.deleteAttachment(name);
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
}

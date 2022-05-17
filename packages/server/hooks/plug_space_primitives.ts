import { Plug } from "@plugos/plugos/plug";
import { SpacePrimitives } from "@silverbulletmd/common/spaces/space_primitives";
import { PageMeta } from "@silverbulletmd/common/types";
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
        for (let pm of await plug.invoke(name, [])) {
          allPages.add(pm);
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

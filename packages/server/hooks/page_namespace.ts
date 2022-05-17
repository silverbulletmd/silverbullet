import { Plug } from "@plugos/plugos/plug";
import { System } from "@plugos/plugos/system";
import { Hook, Manifest } from "@plugos/plugos/types";
import { Express, NextFunction, Request, Response, Router } from "express";

export type PageNamespaceOperation =
  | "readPage"
  | "writePage"
  | "listPages"
  | "getPageMeta"
  | "deletePage";

export type PageNamespaceDef = {
  pattern: string;
  operation: PageNamespaceOperation;
};

export type PageNamespaceHookT = {
  pageNamespace?: PageNamespaceDef;
};

type SpaceFunction = {
  operation: PageNamespaceOperation;
  pattern: RegExp;
  plug: Plug<PageNamespaceHookT>;
  name: string;
};

export class PageNamespaceHook implements Hook<PageNamespaceHookT> {
  spaceFunctions: SpaceFunction[] = [];
  constructor() {}

  apply(system: System<PageNamespaceHookT>): void {
    system.on({
      plugLoaded: () => {
        this.updateCache(system);
      },
      plugUnloaded: () => {
        this.updateCache(system);
      },
    });
  }

  updateCache(system: System<PageNamespaceHookT>) {
    this.spaceFunctions = [];
    for (let plug of system.loadedPlugs.values()) {
      if (plug.manifest?.functions) {
        for (let [funcName, funcDef] of Object.entries(
          plug.manifest.functions
        )) {
          if (funcDef.pageNamespace) {
            this.spaceFunctions.push({
              operation: funcDef.pageNamespace.operation,
              pattern: new RegExp(funcDef.pageNamespace.pattern),
              plug,
              name: funcName,
            });
          }
        }
      }
    }
  }

  validateManifest(manifest: Manifest<PageNamespaceHookT>): string[] {
    let errors: string[] = [];
    if (!manifest.functions) {
      return [];
    }
    for (let [funcName, funcDef] of Object.entries(manifest.functions)) {
      if (funcDef.pageNamespace) {
        if (!funcDef.pageNamespace.pattern) {
          errors.push(`Function ${funcName} has a namespace but no pattern`);
        }
        if (!funcDef.pageNamespace.operation) {
          errors.push(`Function ${funcName} has a namespace but no operation`);
        }
        if (
          !["readPage", "writePage", "getPageMeta", "listPages"].includes(
            funcDef.pageNamespace.operation
          )
        ) {
          errors.push(
            `Function ${funcName} has an invalid operation ${funcDef.pageNamespace.operation}`
          );
        }
      }
    }
    return errors;
  }
}

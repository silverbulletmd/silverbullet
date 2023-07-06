import { Plug } from "../../plugos/plug.ts";
import { System } from "../../plugos/system.ts";
import { Hook, Manifest } from "../../plugos/types.ts";

export type NamespaceOperation =
  | "readFile"
  | "writeFile"
  | "listFiles"
  | "getFileMeta"
  | "deleteFile";

export type PageNamespaceDef = {
  pattern: string;
  operation: NamespaceOperation;
};

export type PageNamespaceHookT = {
  pageNamespace?: PageNamespaceDef;
};

type SpaceFunction = {
  operation: NamespaceOperation;
  pattern: RegExp;
  plug: Plug<PageNamespaceHookT>;
  name: string;
  env?: string;
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
    for (const plug of system.loadedPlugs.values()) {
      if (plug.manifest?.functions) {
        for (
          const [funcName, funcDef] of Object.entries(
            plug.manifest.functions,
          )
        ) {
          if (funcDef.pageNamespace) {
            this.spaceFunctions.push({
              operation: funcDef.pageNamespace.operation,
              pattern: new RegExp(funcDef.pageNamespace.pattern),
              plug,
              name: funcName,
              env: funcDef.env,
            });
          }
        }
      }
    }
  }

  validateManifest(manifest: Manifest<PageNamespaceHookT>): string[] {
    const errors: string[] = [];
    if (!manifest.functions) {
      return [];
    }
    for (const [funcName, funcDef] of Object.entries(manifest.functions)) {
      if (funcDef.pageNamespace) {
        if (!funcDef.pageNamespace.pattern) {
          errors.push(`Function ${funcName} has a namespace but no pattern`);
        }
        if (!funcDef.pageNamespace.operation) {
          errors.push(`Function ${funcName} has a namespace but no operation`);
        }
        if (
          ![
            "readFile",
            "writeFile",
            "getFileMeta",
            "listFiles",
            "deleteFile",
          ].includes(funcDef.pageNamespace.operation)
        ) {
          errors.push(
            `Function ${funcName} has an invalid operation ${funcDef.pageNamespace.operation}`,
          );
        }
      }
    }
    return errors;
  }
}

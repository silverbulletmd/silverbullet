import { NamespaceOperation } from "$lib/plugos/namespace.ts";
import { PlugNamespaceHookT } from "$lib/manifest.ts";
import { Plug } from "../../lib/plugos/plug.ts";
import { System } from "../../lib/plugos/system.ts";
import { Hook, Manifest } from "../../lib/plugos/types.ts";

type SpaceFunction = {
  operation: NamespaceOperation;
  pattern: RegExp;
  plug: Plug<PlugNamespaceHookT>;
  name: string;
  env?: string;
};

export class PlugNamespaceHook implements Hook<PlugNamespaceHookT> {
  spaceFunctions: SpaceFunction[] = [];
  constructor() {}

  apply(system: System<PlugNamespaceHookT>): void {
    system.on({
      plugLoaded: () => {
        this.updateCache(system);
      },
      plugUnloaded: () => {
        this.updateCache(system);
      },
    });
  }

  updateCache(system: System<PlugNamespaceHookT>) {
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

  validateManifest(manifest: Manifest<PlugNamespaceHookT>): string[] {
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

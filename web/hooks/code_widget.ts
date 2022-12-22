import { Hook, Manifest } from "../../plugos/types.ts";
import { System } from "../../plugos/system.ts";

export type CodeWidgetT = {
  codeWidget?: string;
};

export type CodeWidgetCallback = (
  bodyText: string,
) => Promise<{ html: string; script: string }>;

export class CodeWidgetHook implements Hook<CodeWidgetT> {
  codeWidgetCallbacks = new Map<string, CodeWidgetCallback>();

  constructor() {
  }

  collectAllCodeWidgets(system: System<CodeWidgetT>) {
    this.codeWidgetCallbacks.clear();
    for (const plug of system.loadedPlugs.values()) {
      for (
        const [name, functionDef] of Object.entries(
          plug.manifest!.functions,
        )
      ) {
        if (!functionDef.codeWidget) {
          continue;
        }
        this.codeWidgetCallbacks.set(functionDef.codeWidget, (bodyText) => {
          return plug.invoke(name, [bodyText]);
        });
      }
    }
  }

  apply(system: System<CodeWidgetT>): void {
    this.collectAllCodeWidgets(system);
    system.on({
      plugLoaded: () => {
        this.collectAllCodeWidgets(system);
      },
    });
  }

  validateManifest(manifest: Manifest<CodeWidgetT>): string[] {
    const errors = [];
    for (const functionDef of Object.values(manifest.functions)) {
      if (!functionDef.codeWidget) {
        continue;
      }
      if (typeof functionDef.codeWidget !== "string") {
        errors.push(`Codewidgets require a string name.`);
      }
    }
    return errors;
  }
}

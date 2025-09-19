import type { Hook, Manifest } from "../../lib/plugos/types.ts";
import type { System } from "../../lib/plugos/system.ts";
import type { CodeWidgetT } from "../../lib/manifest.ts";
import type { CodeWidgetCallback } from "@silverbulletmd/silverbullet/type/client";

export class CodeWidgetHook implements Hook<CodeWidgetT> {
  codeWidgetCallbacks = new Map<string, CodeWidgetCallback>();
  codeWidgetModes = new Map<string, "markdown" | "iframe">();

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
        this.codeWidgetModes.set(
          functionDef.codeWidget,
          functionDef.renderMode || "iframe",
        );
        this.codeWidgetCallbacks.set(
          functionDef.codeWidget,
          (bodyText, pageName) => {
            return plug.invoke(name, [bodyText, pageName]);
          },
        );
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

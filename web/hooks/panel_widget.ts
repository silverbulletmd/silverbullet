import { Hook, Manifest } from "../../lib/plugos/types.ts";
import { System } from "../../lib/plugos/system.ts";
import { CodeWidgetCallback } from "../../plug-api/types.ts";
import { PanelWidgetT } from "$lib/manifest.ts";

export class PanelWidgetHook implements Hook<PanelWidgetT> {
  callbacks = new Map<string, CodeWidgetCallback>();

  constructor() {
  }

  collectAllPanelWidgets(system: System<PanelWidgetT>) {
    this.callbacks.clear();
    for (const plug of system.loadedPlugs.values()) {
      for (
        const [name, functionDef] of Object.entries(
          plug.manifest!.functions,
        )
      ) {
        if (!functionDef.panelWidget) {
          continue;
        }
        this.callbacks.set(
          functionDef.panelWidget,
          (bodyText, pageName) => {
            return plug.invoke(name, [bodyText, pageName]);
          },
        );
      }
    }
  }

  apply(system: System<PanelWidgetT>): void {
    this.collectAllPanelWidgets(system);
    system.on({
      plugLoaded: () => {
        this.collectAllPanelWidgets(system);
      },
    });
  }

  validateManifest(manifest: Manifest<PanelWidgetT>): string[] {
    const errors = [];
    for (const functionDef of Object.values(manifest.functions)) {
      if (!functionDef.panelWidget) {
        continue;
      }
      if (!["top", "bottom"].includes(functionDef.panelWidget)) {
        errors.push(
          `Panel widgets must be attached to either 'top' or 'bottom'.`,
        );
      }
    }
    return errors;
  }
}

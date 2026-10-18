import type { PanelViewT } from "@silverbulletmd/silverbullet/type/manifest";
import {
  type PanelView,
  validatePanelView,
} from "../../navigator/plug_views.ts";
import { setPanelViews } from "../../navigator/registry.ts";
import type { System } from "../system.ts";
import type { Hook, Manifest } from "../types.ts";

/**
 * Collects the panel views plugs declare (`view:` on a function) into the
 * navigator registry, which hosts each one's panel as a native body.
 */
export class PanelViewHook implements Hook<PanelViewT> {
  private update(system: System<PanelViewT>, unloading?: string): void {
    const views: PanelView[] = [];
    for (const [name, plug] of system.loadedPlugs) {
      if (name === unloading) continue;
      for (const [fn, def] of Object.entries(plug.manifest!.functions)) {
        if (def.view) views.push({ def: def.view, plug: name, fn });
      }
    }
    setPanelViews(views);
  }

  apply(system: System<PanelViewT>): void {
    this.update(system);
    system.on({
      plugLoaded: () => this.update(system),
      // Sent before the plug leaves `loadedPlugs`
      plugUnloaded: (name) => this.update(system, name),
    });
  }

  validateManifest(manifest: Manifest<PanelViewT>): string[] {
    const errors: string[] = [];
    for (const def of Object.values(manifest.functions)) {
      if (def.view !== undefined) errors.push(...validatePanelView(def.view));
    }
    return errors;
  }
}

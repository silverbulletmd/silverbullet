import { Hook, Manifest } from "../types";
import { System } from "../system";
import { safeRun } from "../util";

// System events:
// - plug:load (plugName: string)

export type EventHookT = {
  events?: string[];
};

export class EventHook implements Hook<EventHookT> {
  private system?: System<EventHookT>;

  async dispatchEvent(eventName: string, data?: any): Promise<void> {
    if (!this.system) {
      throw new Error("Event hook is not initialized");
    }
    let promises: Promise<void>[] = [];
    for (const plug of this.system.loadedPlugs.values()) {
      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions
      )) {
        if (functionDef.events && functionDef.events.includes(eventName)) {
          // Only dispatch functions that can run in this environment
          if (plug.canInvoke(name)) {
            promises.push(plug.invoke(name, [data]));
          }
        }
      }
    }
    await Promise.all(promises);
  }

  apply(system: System<EventHookT>): void {
    this.system = system;
    this.system.on({
      plugLoaded: (name) => {
        safeRun(async () => {
          await this.dispatchEvent("plug:load", name);
        });
      },
    });
  }

  validateManifest(manifest: Manifest<EventHookT>): string[] {
    let errors = [];
    for (const [name, functionDef] of Object.entries(manifest.functions)) {
      if (functionDef.events && !Array.isArray(functionDef.events)) {
        errors.push("'events' key must be an array of strings");
      }
    }
    return errors;
  }
}

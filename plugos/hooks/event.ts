import { Hook, Manifest } from "../types";
import { System } from "../system";

// System events:
// - plug:load (plugName: string)

export type EventHookT = {
  events?: string[];
};

export class EventHook implements Hook<EventHookT> {
  private system?: System<EventHookT>;

  async dispatchEvent(eventName: string, data?: any): Promise<any[]> {
    if (!this.system) {
      throw new Error("Event hook is not initialized");
    }
    let promises: Promise<any>[] = [];
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
    return Promise.all(promises);
  }

  apply(system: System<EventHookT>): void {
    this.system = system;
    this.system.on({
      plugLoaded: (name) => {
        this.dispatchEvent("plug:load", name);
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

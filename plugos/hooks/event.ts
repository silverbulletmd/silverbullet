import type { Hook, Manifest } from "../types.ts";
import { System } from "../system.ts";
import { safeRun } from "../util.ts";

// System events:
// - plug:load (plugName: string)

export type EventHookT = {
  events?: string[];
};

export class EventHook implements Hook<EventHookT> {
  private system?: System<EventHookT>;
  public localListeners: Map<string, ((data: any) => any)[]> = new Map();

  addLocalListener(eventName: string, callback: (data: any) => any) {
    if (!this.localListeners.has(eventName)) {
      this.localListeners.set(eventName, []);
    }
    this.localListeners.get(eventName)!.push(callback);
  }

  // Pull all events listened to
  listEvents(): string[] {
    if (!this.system) {
      throw new Error("Event hook is not initialized");
    }
    let eventNames = new Set<string>();
    for (const plug of this.system.loadedPlugs.values()) {
      for (const functionDef of Object.values(plug.manifest!.functions)) {
        if (functionDef.events) {
          for (let eventName of functionDef.events) {
            eventNames.add(eventName);
          }
        }
      }
    }
    for (let eventName of this.localListeners.keys()) {
      eventNames.add(eventName);
    }

    return [...eventNames];
  }

  async dispatchEvent(eventName: string, data?: any): Promise<any[]> {
    if (!this.system) {
      throw new Error("Event hook is not initialized");
    }
    let responses: any[] = [];
    for (const plug of this.system.loadedPlugs.values()) {
      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions
      )) {
        if (functionDef.events && functionDef.events.includes(eventName)) {
          // Only dispatch functions that can run in this environment
          if (plug.canInvoke(name)) {
            let result = await plug.invoke(name, [data]);
            if (result !== undefined) {
              responses.push(result);
            }
          }
        }
      }
    }
    let localListeners = this.localListeners.get(eventName);
    if (localListeners) {
      for (let localListener of localListeners) {
        let result = await Promise.resolve(localListener(data));
        if (result) {
          responses.push(result);
        }
      }
    }

    return responses;
  }

  apply(system: System<EventHookT>): void {
    this.system = system;
    this.system.on({
      plugLoaded: (plug) => {
        safeRun(async () => {
          await this.dispatchEvent("plug:load", plug.name);
        });
      },
    });
  }

  validateManifest(manifest: Manifest<EventHookT>): string[] {
    let errors = [];
    for (const [name, functionDef] of Object.entries(
      manifest.functions || {}
    )) {
      if (functionDef.events && !Array.isArray(functionDef.events)) {
        errors.push("'events' key must be an array of strings");
      }
    }
    return errors;
  }
}

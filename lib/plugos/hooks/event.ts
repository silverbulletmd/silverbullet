import type { Hook, Manifest } from "../types.ts";
import { System } from "../system.ts";

// System events:
// - plug:load (plugName: string)

export type EventHookT = {
  events?: string[];
};

export class EventHook implements Hook<EventHookT> {
  private system?: System<EventHookT>;
  public localListeners: Map<string, ((...args: any[]) => any)[]> = new Map();

  addLocalListener(eventName: string, callback: (...args: any[]) => any) {
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
    const eventNames = new Set<string>();
    for (const plug of this.system.loadedPlugs.values()) {
      for (const functionDef of Object.values(plug.manifest!.functions)) {
        if (functionDef.events) {
          for (const eventName of functionDef.events) {
            eventNames.add(eventName);
          }
        }
      }
    }
    for (const eventName of this.localListeners.keys()) {
      eventNames.add(eventName);
    }

    return [...eventNames];
  }

  async dispatchEvent(eventName: string, ...args: any[]): Promise<any[]> {
    if (!this.system) {
      throw new Error("Event hook is not initialized");
    }
    const responses: any[] = [];
    const promises: Promise<void>[] = [];
    for (const plug of this.system.loadedPlugs.values()) {
      const manifest = plug.manifest;
      for (
        const [name, functionDef] of Object.entries(
          manifest!.functions,
        )
      ) {
        if (functionDef.events) {
          for (const event of functionDef.events) {
            if (
              event === eventName || eventNameToRegex(event).test(eventName)
            ) {
              // Only dispatch functions that can run in this environment
              if (await plug.canInvoke(name)) {
                // Queue the promise
                promises.push((async () => {
                  try {
                    const result = await plug.invoke(name, args);
                    if (result !== undefined) {
                      responses.push(result);
                    }
                  } catch (e: any) {
                    console.error(
                      `Error dispatching event ${eventName} to ${plug.name}.${name}: ${e.message}`,
                    );
                  }
                })());
              }
            }
          }
        }
      }
    }
    const localListeners = this.localListeners.get(eventName);
    if (localListeners) {
      for (const localListener of localListeners) {
        // Queue the promise
        promises.push((async () => {
          const result = await Promise.resolve(localListener(...args));
          if (result) {
            responses.push(result);
          }
        })());
      }
    }

    // Wait for all promises to resolve
    await Promise.all(promises);

    return responses;
  }

  apply(system: System<EventHookT>): void {
    this.system = system;
    this.system.on({
      plugLoaded: async (plug) => {
        await this.dispatchEvent("plug:load", plug.name);
      },
    });
  }

  validateManifest(manifest: Manifest<EventHookT>): string[] {
    const errors = [];
    for (
      const [_, functionDef] of Object.entries(
        manifest.functions || {},
      )
    ) {
      if (functionDef.events && !Array.isArray(functionDef.events)) {
        errors.push("'events' key must be an array of strings");
      }
    }
    return errors;
  }
}

function eventNameToRegex(eventName: string): RegExp {
  return new RegExp(
    `^${eventName.replace(/\*/g, ".*").replace(/\//g, "\\/")}$`,
  );
}

import type { Manifest } from "../types.ts";
import type { System } from "../system.ts";
import type { EventHookI } from "../eventhook.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import type { Config } from "../../config.ts";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import { listenerDefinition, type DefinedListener } from "../syscalls/event.ts";

export type EventResultWithSource = {
  value: any;
  definition: Ref | null;
  // "plug.function" for plug listeners
  listener?: string;
};

// System events:
// - plug:load (plugName: string)

export class EventHook implements EventHookI {
  private system?: System<EventHookT>;
  private localListeners: Map<string, ((...args: any[]) => any)[]> = new Map();

  constructor(readonly config?: Config) {}

  addLocalListener(eventName: string, callback: (...args: any[]) => any) {
    if (!this.localListeners.has(eventName)) {
      this.localListeners.set(eventName, []);
    }
    this.localListeners.get(eventName)!.push(callback);
  }

  removeLocalListener(eventName: string, callback: (...args: any[]) => any) {
    if (!this.localListeners.has(eventName)) {
      return;
    }
    const listeners = this.localListeners.get(eventName)!;
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
    if (listeners.length === 0) {
      this.localListeners.delete(eventName);
    }
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
    if (this.config) {
      const configListeners: Record<string, Function[]> = this.config.get(
        "eventListeners",
        {},
      );
      for (const name of Object.keys(configListeners)) {
        eventNames.add(name);
      }
    }

    return [...eventNames];
  }

  async dispatchEvent(eventName: string, ...args: any[]): Promise<any[]> {
    return (await this.dispatch(eventName, args, false)).map(
      ({ value }) => value,
    );
  }

  async dispatchEventStrict(eventName: string, ...args: any[]): Promise<any[]> {
    return (await this.dispatch(eventName, args, true)).map(
      ({ value }) => value,
    );
  }

  async dispatchEventWithSources(
    eventName: string,
    ...args: any[]
  ): Promise<EventResultWithSource[]> {
    return this.dispatch(eventName, args, false);
  }

  private async dispatch(
    eventName: string,
    args: any[],
    strict: boolean,
  ): Promise<EventResultWithSource[]> {
    if (!this.system) {
      throw new Error("Event hook is not initialized");
    }
    const promises: {
      promise: Promise<any>;
      definition: Ref | null;
      listener?: string;
    }[] = [];
    for (const plug of this.system.loadedPlugs.values()) {
      const manifest = plug.manifest;
      for (const [name, functionDef] of Object.entries(manifest!.functions)) {
        if (functionDef.events) {
          for (const event of functionDef.events) {
            if (
              event === eventName ||
              eventNameToRegex(event).test(eventName)
            ) {
              if (plug.canInvoke(name)) {
                promises.push({
                  definition: null,
                  listener: `${plug.manifest.name}.${name}`,
                  promise: (async () => {
                    try {
                      return await plug.invoke(name, args);
                    } catch (e: any) {
                      console.error(
                        `Error dispatching event ${eventName} to ${plug.manifest.name}.${name}: ${e.message}`,
                      );
                      throw e;
                    }
                  })(),
                });
              }
            }
          }
        }
      }
    }

    for (const [name, localListeners] of this.localListeners) {
      if (eventNameToRegex(name).test(eventName)) {
        for (const localListener of localListeners) {
          promises.push({
            definition: null,
            promise: (async () => {
              return await Promise.resolve(localListener(...args));
            })(),
          });
        }
      }
    }

    if (this.config) {
      const configListeners: Record<string, DefinedListener[]> =
        this.config.get("eventListeners", {});
      for (const [name, listeners] of Object.entries(configListeners)) {
        if (eventNameToRegex(name).test(eventName)) {
          for (const listener of listeners) {
            promises.push({
              definition: listener[listenerDefinition] ?? null,
              promise: (async () => {
                return await Promise.resolve(
                  listener({
                    name: eventName,
                    // Most events have a single argument, so let's optimize for that, otherwise pass all arguments as an array
                    data: args.length === 1 ? args[0] : args,
                  }),
                );
              })(),
            });
          }
        }
      }
    }

    const settled = await Promise.allSettled(
      promises.map(({ promise }) => promise),
    );
    if (strict) {
      const failure = settled.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
    return settled
      .map((result, index) => ({
        result,
        definition: promises[index].definition,
        listener: promises[index].listener,
      }))
      .filter(({ result }) => {
        if (result.status === "rejected") {
          console.error(
            "Error while dispatching event",
            eventName,
            ":",
            result.reason,
          );
        }
        return result.status === "fulfilled";
      })
      .map(({ result, definition, listener }) => ({
        value: result.status === "fulfilled" ? result.value : undefined,
        definition,
        ...(listener ? { listener } : {}),
      }))
      .filter(({ value }) => value != null); // This keeps non-null/undefined results
  }

  apply(system: System<EventHookT>): void {
    this.system = system;
    this.system.on({
      plugLoaded: async (plug) => {
        await this.dispatchEvent("plug:load", plug.manifest.name);
      },
    });
  }

  validateManifest(manifest: Manifest<EventHookT>): string[] {
    const errors = [];
    for (const [_, functionDef] of Object.entries(manifest.functions || {})) {
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

import { Feature, Manifest } from "../types";
import { System } from "../system";

export type EventHook = {
  events?: { [key: string]: string[] };
};

export class EventFeature implements Feature<EventHook> {
  private system?: System<EventHook>;

  async dispatchEvent(name: string, data?: any): Promise<any[]> {
    if (!this.system) {
      throw new Error("EventFeature is not initialized");
    }
    let promises: Promise<any>[] = [];
    for (const plug of this.system.loadedPlugs.values()) {
      if (!plug.manifest!.hooks?.events) {
        continue;
      }
      let functionsToSpawn = plug.manifest!.hooks.events[name];
      if (functionsToSpawn) {
        functionsToSpawn.forEach((functionToSpawn) => {
          // Only dispatch functions on events when they're allowed to be invoked in this environment
          if (plug.canInvoke(functionToSpawn)) {
            promises.push(plug.invoke(functionToSpawn, [data]));
          }
        });
      }
    }
    return Promise.all(promises);
  }

  apply(system: System<EventHook>): void {
    this.system = system;
    system.on({
      plugLoaded: (name, plug) => {},
    });
  }

  validateManifest(manifest: Manifest<EventHook>): string[] {
    return [];
  }
}

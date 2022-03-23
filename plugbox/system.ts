import { Feature, Manifest, RuntimeEnvironment } from "./types";
import { EventEmitter } from "../common/event";
import { Sandbox } from "./sandbox";
import { Plug } from "./plug";

interface SysCallMapping {
  [key: string]: (...args: any) => Promise<any> | any;
}

export type SystemJSON<HookT> = { [key: string]: Manifest<HookT> };
export type SystemEvents<HookT> = {
  plugLoaded: (name: string, plug: Plug<HookT>) => void;
  plugUnloaded: (name: string, plug: Plug<HookT>) => void;
};

export class System<HookT> extends EventEmitter<SystemEvents<HookT>> {
  protected plugs = new Map<string, Plug<HookT>>();
  registeredSyscalls: SysCallMapping = {};
  protected enabledFeatures = new Set<Feature<HookT>>();

  readonly runtimeEnv: RuntimeEnvironment;

  constructor(env: RuntimeEnvironment) {
    super();
    this.runtimeEnv = env;
  }

  addFeature(feature: Feature<HookT>) {
    this.enabledFeatures.add(feature);
    feature.apply(this);
  }

  registerSyscalls(...registrationObjects: SysCallMapping[]) {
    for (const registrationObject of registrationObjects) {
      for (let p in registrationObject) {
        this.registeredSyscalls[p] = registrationObject[p];
      }
    }
  }

  async syscall(name: string, args: Array<any>): Promise<any> {
    const callback = this.registeredSyscalls[name];
    if (!name) {
      throw Error(`Unregistered syscall ${name}`);
    }
    if (!callback) {
      throw Error(`Registered but not implemented syscall ${name}`);
    }
    return Promise.resolve(callback(...args));
  }

  async load(
    name: string,
    manifest: Manifest<HookT>,
    sandbox: Sandbox
  ): Promise<Plug<HookT>> {
    if (this.plugs.has(name)) {
      await this.unload(name);
    }
    // Validate
    let errors: string[] = [];
    for (const feature of this.enabledFeatures) {
      errors = [...errors, ...feature.validateManifest(manifest)];
    }
    if (errors.length > 0) {
      throw new Error(`Invalid manifest: ${errors.join(", ")}`);
    }
    // Ok, let's load this thing!
    const plug = new Plug(this, name, sandbox);
    await plug.load(manifest);
    this.plugs.set(name, plug);
    this.emit("plugLoaded", name, plug);
    return plug;
  }

  async unload(name: string) {
    const plug = this.plugs.get(name);
    if (!plug) {
      throw Error(`Plug ${name} not found`);
    }
    await plug.stop();
    this.emit("plugUnloaded", name, plug);
    this.plugs.delete(name);
  }

  async dispatchEvent(name: string, data?: any): Promise<any[]> {
    let promises = [];
    for (let plug of this.plugs.values()) {
      for (let result of await plug.dispatchEvent(name, data)) {
        promises.push(result);
      }
    }
    return await Promise.all(promises);
  }

  get loadedPlugs(): Map<string, Plug<HookT>> {
    return this.plugs;
  }

  toJSON(): SystemJSON<HookT> {
    let plugJSON: { [key: string]: Manifest<HookT> } = {};
    for (let [name, plug] of this.plugs) {
      if (!plug.manifest) {
        continue;
      }
      plugJSON[name] = plug.manifest;
    }
    return plugJSON;
  }

  async replaceAllFromJSON(
    json: SystemJSON<HookT>,
    sandboxFactory: () => Sandbox
  ) {
    await this.unloadAll();
    for (let [name, manifest] of Object.entries(json)) {
      console.log("Loading plug", name);
      await this.load(name, manifest, sandboxFactory());
    }
  }

  async unloadAll(): Promise<void[]> {
    return Promise.all(
      Array.from(this.plugs.keys()).map(this.unload.bind(this))
    );
  }
}

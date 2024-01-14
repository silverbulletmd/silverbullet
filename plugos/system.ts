import { Hook } from "./types.ts";
import { EventEmitter } from "./event.ts";
import type { SandboxFactory } from "./sandboxes/sandbox.ts";
import { Plug } from "./plug.ts";
import { InMemoryManifestCache, ManifestCache } from "./manifest_cache.ts";

export interface SysCallMapping {
  [key: string]: (...args: any) => Promise<any> | any;
}

export type SystemEvents<HookT> = {
  plugLoaded: (plug: Plug<HookT>) => void | Promise<void>;
  plugUnloaded: (name: string) => void | Promise<void>;
};

type SyscallSignature = (
  ...args: any[]
) => Promise<any> | any;

type Syscall = {
  requiredPermissions: string[];
  callback: SyscallSignature;
};

export type SystemOptions = {
  manifestCache?: ManifestCache<any>;
  plugFlushTimeout?: number;
};

export class System<HookT> extends EventEmitter<SystemEvents<HookT>> {
  protected plugs = new Map<string, Plug<HookT>>();
  protected registeredSyscalls = new Map<string, Syscall>();
  protected enabledHooks = new Set<Hook<HookT>>();

  private grantedPermissions: string[] = [];

  /**
   * @param env either an environment or undefined for hybrid mode
   */
  constructor(
    readonly env: string | undefined,
    readonly options: SystemOptions = {},
  ) {
    super();
    if (!options.manifestCache) {
      options.manifestCache = new InMemoryManifestCache();
    }
  }

  get loadedPlugs(): Map<string, Plug<HookT>> {
    return this.plugs;
  }

  addHook(feature: Hook<HookT>) {
    this.enabledHooks.add(feature);
    feature.apply(this);
  }

  registerSyscalls(
    requiredCapabilities: string[],
    ...registrationObjects: SysCallMapping[]
  ) {
    for (const registrationObject of registrationObjects) {
      for (const [name, callback] of Object.entries(registrationObject)) {
        this.registeredSyscalls.set(name, {
          requiredPermissions: requiredCapabilities,
          callback,
        });
      }
    }
  }

  syscall(
    name: string,
    args: any[],
  ): Promise<any> {
    const syscall = this.registeredSyscalls.get(name);
    if (!syscall) {
      throw Error(`Unregistered syscall ${name}`);
    }
    for (const permission of syscall.requiredPermissions) {
      if (!this.grantedPermissions.includes(permission)) {
        throw Error(`Missing permission '${permission}' for syscall ${name}`);
      }
    }
    return Promise.resolve(syscall.callback(...args));
  }

  async load(
    name: string,
    sandboxFactory: SandboxFactory<HookT>,
    workerUrl: URL | undefined = undefined,
    hash = -1,
  ): Promise<Plug<HookT>> {
    const plug = new Plug(this, workerUrl, name, hash, sandboxFactory);

    // Wait for worker to boot, and pass back its manifest
    await plug.ready;

    // and there it is!
    const manifest = plug.manifest!;

    // Validate the manifest
    let errors: string[] = [];
    for (const feature of this.enabledHooks) {
      errors = [...errors, ...feature.validateManifest(plug.manifest!)];
    }
    if (errors.length > 0) {
      throw new Error(`Invalid manifest: ${errors.join(", ")}`);
    }
    if (this.plugs.has(manifest.name)) {
      this.unload(manifest.name);
    }
    console.log("Activated plug", manifest.name);
    this.plugs.set(manifest.name, plug);

    await this.emit("plugLoaded", plug);
    return plug;
  }

  /**
   * Loads a plug without a sandbox, which means it will run in the same context as the caller
   * @param name
   * @param plugExport extracted via e.g. `import { plug } from "./some.plug.js`
   * @returns Plug instance
   */
  // async loadNoSandbox(
  //   name: string,
  //   plugExport: PlugExport<any>,
  // ): Promise<Plug<HookT>> {
  //   const plug = new Plug(
  //     this,
  //     undefined,
  //     name,
  //     -1,
  //     noSandboxFactory(plugExport),
  //   );

  //   const manifest = plugExport.manifest;

  //   // Validate the manifest
  //   let errors: string[] = [];
  //   for (const feature of this.enabledHooks) {
  //     errors = [...errors, ...feature.validateManifest(plug.manifest!)];
  //   }
  //   if (errors.length > 0) {
  //     throw new Error(`Invalid manifest: ${errors.join(", ")}`);
  //   }
  //   if (this.plugs.has(manifest.name)) {
  //     this.unload(manifest.name);
  //   }
  //   console.log("Activated plug without sandbox", manifest.name);
  //   this.plugs.set(manifest.name, plug);

  //   await this.emit("plugLoaded", plug);
  //   return plug;
  // }

  unload(name: string) {
    const plug = this.plugs.get(name);
    if (!plug) {
      return;
    }
    plug.stop();
    this.emit("plugUnloaded", name);
    this.plugs.delete(name);
  }

  unloadAll(): Promise<void[]> {
    return Promise.all(
      Array.from(this.plugs.keys()).map(this.unload.bind(this)),
    );
  }
}

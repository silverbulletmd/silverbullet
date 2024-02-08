import { Hook } from "./types.ts";
import { EventEmitter } from "./event.ts";
import type { SandboxFactory } from "./sandboxes/sandbox.ts";
import { Plug } from "./plug.ts";
import { InMemoryManifestCache, ManifestCache } from "./manifest_cache.ts";

export interface SysCallMapping {
  [key: string]: (ctx: SyscallContext, ...args: any) => Promise<any> | any;
}

export type SystemEvents<HookT> = {
  plugLoaded: (plug: Plug<HookT>) => void | Promise<void>;
  plugUnloaded: (name: string) => void | Promise<void>;
};

// Passed to every syscall, allows to pass in additional context that the syscall may use
export type SyscallContext = {
  // This is the plug that is invoking the syscall,
  // which may be undefined where this cannot be determined (e.g. when running in a NoSandbox)
  plug?: string;
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
  registeredSyscalls = new Map<string, Syscall>();
  protected enabledHooks = new Set<Hook<HookT>>();

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

  /**
   * Invokes a function named using the "plug.functionName" pattern, for convenience
   * @param name name of the function (e.g. plug.doSomething)
   * @param args an array of arguments to pass to the function
   */
  invokeFunction(name: string, args: any[]): Promise<any> {
    // Some sanity type checks
    if (typeof name !== "string") {
      throw new Error(
        `invokeFunction: function name should be a string, got ${typeof name}`,
      );
    }
    if (!Array.isArray(args)) {
      throw new Error(
        `invokeFunction: args should be an array, got ${typeof args}`,
      );
    }
    const [plugName, functionName] = name.split(".");
    if (!functionName) {
      // Sanity check
      throw new Error(`Missing function name: ${name}`);
    }
    const plug = this.loadedPlugs.get(plugName);
    if (!plug) {
      throw new Error(`Plug ${plugName} not found invoking ${name}`);
    }
    return plug.invoke(functionName, args);
  }

  localSyscall(name: string, args: any[]): Promise<any> {
    return this.syscall({}, name, args);
  }

  syscall(
    ctx: SyscallContext,
    name: string,
    args: any[],
  ): Promise<any> {
    const syscall = this.registeredSyscalls.get(name);
    if (!syscall) {
      throw Error(`Unregistered syscall ${name}`);
    }
    if (ctx.plug) {
      // Only when running in a plug context do we check permissions
      const plug = this.loadedPlugs.get(ctx.plug);
      if (!plug) {
        throw new Error(
          `Plug ${ctx.plug} not found while attempting to invoke ${name}}`,
        );
      }
      for (const permission of syscall.requiredPermissions) {
        if (!plug.grantedPermissions.includes(permission)) {
          throw Error(`Missing permission '${permission}' for syscall ${name}`);
        }
      }
    }
    return Promise.resolve(syscall.callback(ctx, ...args));
  }

  async load(
    name: string,
    sandboxFactory: SandboxFactory<HookT>,
    hash = -1,
  ): Promise<Plug<HookT>> {
    const plug = new Plug(this, name, hash, sandboxFactory);

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

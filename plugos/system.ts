import { Hook, Manifest, RuntimeEnvironment } from "./types";
import { EventEmitter } from "../common/event";
import { SandboxFactory } from "./sandbox";
import { Plug } from "./plug";

export interface SysCallMapping {
  [key: string]: (ctx: SyscallContext, ...args: any) => Promise<any> | any;
}

export type SystemJSON<HookT> = { [key: string]: Manifest<HookT> };

export type SystemEvents<HookT> = {
  plugLoaded: (name: string, plug: Plug<HookT>) => void;
  plugUnloaded: (name: string, plug: Plug<HookT>) => void;
};

export type SyscallContext = {
  plug: Plug<any>;
};

type SyscallSignature = (
  ctx: SyscallContext,
  ...args: any[]
) => Promise<any> | any;

type Syscall = {
  requiredPermissions: string[];
  callback: SyscallSignature;
};

export class System<HookT> extends EventEmitter<SystemEvents<HookT>> {
  protected plugs = new Map<string, Plug<HookT>>();
  protected registeredSyscalls = new Map<string, Syscall>();
  protected enabledHooks = new Set<Hook<HookT>>();

  readonly runtimeEnv: RuntimeEnvironment;

  constructor(env: RuntimeEnvironment) {
    super();
    this.runtimeEnv = env;
  }

  addHook(feature: Hook<HookT>) {
    this.enabledHooks.add(feature);
    feature.apply(this);
  }

  registerSyscalls(
    namespace: string,
    requiredCapabilities: string[],
    ...registrationObjects: SysCallMapping[]
  ) {
    for (const registrationObject of registrationObjects) {
      for (let [name, callback] of Object.entries(registrationObject)) {
        const callName = namespace ? `${namespace}.${name}` : name;
        this.registeredSyscalls.set(callName, {
          requiredPermissions: requiredCapabilities,
          callback,
        });
      }
    }
  }

  async syscallWithContext(
    ctx: SyscallContext,
    name: string,
    args: any[]
  ): Promise<any> {
    const syscall = this.registeredSyscalls.get(name);
    if (!syscall) {
      throw Error(`Unregistered syscall ${name}`);
    }
    for (const permission of syscall.requiredPermissions) {
      if (!ctx.plug) {
        throw Error(`Syscall ${name} requires permission and no plug is set`);
      }
      if (!ctx.plug.grantedPermissions.includes(permission)) {
        throw Error(`Missing permission '${permission}' for syscall ${name}`);
      }
    }
    return Promise.resolve(syscall.callback(ctx, ...args));
  }

  async load(
    name: string,
    manifest: Manifest<HookT>,
    sandboxFactory: SandboxFactory<HookT>
  ): Promise<Plug<HookT>> {
    if (this.plugs.has(name)) {
      console.log("Unloading", name);
      await this.unload(name);
    }
    // Validate
    let errors: string[] = [];
    for (const feature of this.enabledHooks) {
      errors = [...errors, ...feature.validateManifest(manifest)];
    }
    if (errors.length > 0) {
      throw new Error(`Invalid manifest: ${errors.join(", ")}`);
    }
    // Ok, let's load this thing!
    const plug = new Plug(this, name, sandboxFactory);
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
    sandboxFactory: SandboxFactory<HookT>
  ) {
    await this.unloadAll();
    for (let [name, manifest] of Object.entries(json)) {
      console.log("Loading plug", name);
      await this.load(name, manifest, sandboxFactory);
    }
  }

  async unloadAll(): Promise<void[]> {
    return Promise.all(
      Array.from(this.plugs.keys()).map(this.unload.bind(this))
    );
  }
}

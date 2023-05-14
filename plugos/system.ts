import { Hook, Manifest, RuntimeEnvironment } from "./types.ts";
import { EventEmitter } from "./event.ts";
import { Sandbox, SandboxFactory } from "./sandbox.ts";
import { Plug } from "./plug.ts";

export interface SysCallMapping {
  [key: string]: (ctx: SyscallContext, ...args: any) => Promise<any> | any;
}

export type SystemJSON<HookT> = Manifest<HookT>[];

export type SystemEvents<HookT> = {
  plugLoaded: (plug: Plug<HookT>) => void | Promise<void>;
  sandboxInitialized(sandbox: Sandbox, plug: Plug<HookT>): void | Promise<void>;
  plugUnloaded: (name: string) => void | Promise<void>;
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

  constructor(readonly env?: RuntimeEnvironment) {
    super();
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

  syscallWithContext(
    ctx: SyscallContext,
    name: string,
    args: any[],
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

  localSyscall(
    contextPlugName: string,
    syscallName: string,
    args: any[],
  ): Promise<any> {
    return this.syscallWithContext(
      // Mock the plug
      { plug: { name: contextPlugName } as any },
      syscallName,
      args,
    );
  }

  async load(
    workerUrl: URL,
    sandboxFactory: SandboxFactory<HookT>,
  ): Promise<Plug<HookT>> {
    const plug = new Plug(this, workerUrl, sandboxFactory);
    await plug.ready;
    const manifest = plug.manifest!;

    // Validate
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
    console.log("Loaded plug", manifest.name);
    this.plugs.set(manifest.name, plug);

    await this.emit("plugLoaded", plug);
    return plug;
  }

  unload(name: string) {
    console.log("Unloading", name);
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

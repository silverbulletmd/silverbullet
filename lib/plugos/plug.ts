import type { Manifest } from "./types.ts";
import type { System } from "./system.ts";
import type { AssetBundle } from "../asset_bundle/bundle.ts";
import type { Sandbox, SandboxFactory } from "./sandboxes/sandbox.ts";

export class Plug<HookT> {
  readonly runtimeEnv?: string;

  public grantedPermissions: string[] = [];
  public sandbox: Sandbox<HookT>;

  public manifest!: Manifest<HookT>;
  public assets?: AssetBundle;

  constructor(
    readonly system: System<HookT>,
    sandboxFactory: SandboxFactory<HookT>,
  ) {
    this.runtimeEnv = system.env;
    this.sandbox = sandboxFactory(this);
  }

  static async createLazyily<HookT>(
    system: System<HookT>,
    cacheKey: string,
    cacheHash: number,
    sandboxFactory: SandboxFactory<HookT>,
  ): Promise<Plug<HookT>> {
    const plug = new Plug(
      system,
      sandboxFactory,
    );

    // Retrieve the manifest, which may either come from a cache or be loaded from the worker
    plug.manifest = await system.options.manifestCache!.getManifest(
      plug,
      cacheKey,
      cacheHash,
    );

    // TODO: These need to be explicitly granted, not just taken
    plug.grantedPermissions = plug.manifest.requiredPermissions || [];

    return plug;
  }

  // Invoke a syscall
  syscall(name: string, args: any[]): Promise<any> {
    return this.system.syscall({ plug: this.manifest.name }, name, args);
  }

  /**
   * Checks if a function can be invoked (it may be restricted on its execution environment)
   */
  canInvoke(name: string) {
    const funDef = this.manifest!.functions[name];
    if (!funDef) {
      throw new Error(`Function ${name} not found in manifest`);
    }
    return !funDef.env || !this.runtimeEnv || funDef.env === this.runtimeEnv;
  }

  // Invoke a function
  async invoke(name: string, args: any[]): Promise<any> {
    // Before we access the manifest
    const funDef = this.manifest!.functions[name];
    if (!funDef) {
      throw new Error(`Function ${name} not found in manifest`);
    }
    const sandbox = this.sandbox!;
    if (funDef.redirect) {
      // Function redirect, look up
      // deno-lint-ignore no-this-alias
      let plug: Plug<HookT> | undefined = this;
      if (funDef.redirect.indexOf(".") !== -1) {
        const [plugName, functionName] = funDef.redirect.split(".");
        plug = this.system.loadedPlugs.get(plugName);
        if (!plug) {
          throw Error(`Plug ${plugName} redirected to not found`);
        }
        name = functionName;
      } else {
        name = funDef.redirect;
      }
      return plug.invoke(name, args);
    }
    if (!await this.canInvoke(name)) {
      throw new Error(
        `Function ${name} is not available in ${this.runtimeEnv}`,
      );
    }
    return sandbox.invoke(name, args);
  }

  stop() {
    console.log("Stopping sandbox for", this.manifest.name);
    this.sandbox.stop();
  }
}

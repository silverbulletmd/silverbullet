import { Manifest } from "./types.ts";
import { System } from "./system.ts";
import { AssetBundle } from "../asset_bundle/bundle.ts";
import { Sandbox, SandboxFactory } from "./sandboxes/sandbox.ts";

export class Plug<HookT> {
  readonly runtimeEnv?: string;

  public grantedPermissions: string[] = [];
  public sandbox: Sandbox<HookT>;

  // Resolves once the plug's manifest is available
  ready: Promise<void>;

  // Only available after ready resolves
  public manifest?: Manifest<HookT>;
  public assets?: AssetBundle;

  // Time of last function invocation
  unloadTimeout?: number;

  constructor(
    private system: System<HookT>,
    readonly name: string,
    private hash: number,
    private sandboxFactory: SandboxFactory<HookT>,
  ) {
    this.runtimeEnv = system.env;

    this.scheduleUnloadTimeout();

    this.sandbox = this.sandboxFactory(this);
    // Retrieve the manifest asynchonously, which may either come from a cache or be loaded from the worker
    this.ready = system.options.manifestCache!.getManifest(this, this.hash)
      .then(
        (manifest) => {
          this.manifest = manifest;
          // TODO: These need to be explicitly granted, not just taken
          this.grantedPermissions = manifest.requiredPermissions || [];
        },
      );
  }

  // Invoke a syscall
  syscall(name: string, args: any[]): Promise<any> {
    return this.system.syscall({ plug: this.name }, name, args);
  }

  /**
   * Checks if a function can be invoked (it may be restricted on its execution environment)
   */
  async canInvoke(name: string) {
    await this.ready;
    const funDef = this.manifest!.functions[name];
    if (!funDef) {
      throw new Error(`Function ${name} not found in manifest`);
    }
    return !funDef.env || !this.runtimeEnv || funDef.env === this.runtimeEnv;
  }

  scheduleUnloadTimeout() {
    if (!this.system.options.plugFlushTimeout) {
      return;
    }
    // Reset the unload timeout, if set
    if (this.unloadTimeout) {
      clearTimeout(this.unloadTimeout);
    }
    this.unloadTimeout = setTimeout(() => {
      this.stop();
    }, this.system.options.plugFlushTimeout);
  }

  // Invoke a function
  async invoke(name: string, args: any[]): Promise<any> {
    // Ensure the worker is fully up and running
    await this.ready;

    this.scheduleUnloadTimeout();

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
    console.log("Stopping sandbox for", this.name);
    this.sandbox.stop();
  }
}

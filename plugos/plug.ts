import { Manifest, RuntimeEnvironment } from "./types.ts";
import { Sandbox } from "./sandbox.ts";
import { System } from "./system.ts";
import { AssetBundle, AssetJson } from "./asset_bundle/bundle.ts";

export class Plug<HookT> {
  readonly runtimeEnv?: RuntimeEnvironment;

  public grantedPermissions: string[] = [];
  public sandbox: Sandbox<HookT>;

  // Resolves once the worker has been loaded
  ready: Promise<void>;

  // Only available after ready resolves
  public manifest?: Manifest<HookT>;
  public assets?: AssetBundle;

  constructor(
    private system: System<HookT>,
    public workerUrl: URL,
    private sandboxFactory: (plug: Plug<HookT>) => Sandbox<HookT>,
  ) {
    this.runtimeEnv = system.env;

    // Kick off worker
    this.sandbox = this.sandboxFactory(this);
    this.ready = this.sandbox.ready.then(() => {
      this.manifest = this.sandbox.manifest!;
      this.assets = new AssetBundle(
        this.manifest.assets ? this.manifest.assets as AssetJson : {},
      );
      // TODO: These need to be explicitly granted, not just taken
      this.grantedPermissions = this.manifest.requiredPermissions || [];
    });
  }

  get name(): string | undefined {
    return this.manifest?.name;
  }

  // Invoke a syscall
  syscall(name: string, args: any[]): Promise<any> {
    return this.system.syscallWithContext({ plug: this }, name, args);
  }

  // Checks if a function can be invoked (it may be restricted on its execution environment)
  async canInvoke(name: string) {
    await this.ready;
    const funDef = this.manifest!.functions[name];
    if (!funDef) {
      throw new Error(`Function ${name} not found in manifest`);
    }
    return !funDef.env || !this.runtimeEnv || funDef.env === this.runtimeEnv;
  }

  // Invoke a function
  async invoke(name: string, args: any[]): Promise<any> {
    // Ensure the worker is fully up and running
    await this.ready;

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
    return await sandbox.invoke(name, args);
  }

  stop() {
    if (this.sandbox) {
      this.sandbox.stop();
    }
  }
}

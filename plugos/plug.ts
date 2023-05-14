import { Manifest, RuntimeEnvironment } from "./types.ts";
import { Sandbox } from "./sandbox.ts";
import { System } from "./system.ts";
import { AssetBundle, AssetJson } from "./asset_bundle/bundle.ts";

export class Plug<HookT> {
  system: System<HookT>;
  sandbox: Sandbox;
  public manifest?: Manifest<HookT>;
  public assets?: AssetBundle;
  private sandboxFactory: (plug: Plug<HookT>) => Sandbox;
  readonly runtimeEnv?: RuntimeEnvironment;
  grantedPermissions: string[] = [];
  // Only available after ready resolves
  name?: string;
  workerCode: string;

  ready: Promise<void>;

  constructor(
    system: System<HookT>,
    workerCode: string,
    sandboxFactory: (plug: Plug<HookT>) => Sandbox,
  ) {
    this.system = system;
    this.sandboxFactory = sandboxFactory;
    this.workerCode = workerCode;
    this.runtimeEnv = system.env;

    // Kick off worker
    this.sandbox = this.sandboxFactory(this);
    this.ready = new Promise((resolve) => {
      this.sandbox.manifest.then((manifest) => {
        this.manifest = manifest;
        this.name = manifest.name;
        this.assets = new AssetBundle(
          manifest.assets ? manifest.assets as AssetJson : {},
        );
        // TODO: These need to be explicitly granted, not just taken
        this.grantedPermissions = manifest.requiredPermissions || [];
        resolve();
      });
    });
  }

  syscall(name: string, args: any[]): Promise<any> {
    return this.system.syscallWithContext({ plug: this }, name, args);
  }

  async canInvoke(name: string) {
    await this.ready;
    const funDef = this.manifest!.functions[name];
    if (!funDef) {
      throw new Error(`Function ${name} not found in manifest`);
    }
    return !funDef.env || !this.runtimeEnv || funDef.env === this.runtimeEnv;
  }

  async invoke(name: string, args: any[]): Promise<any> {
    await this.ready;
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

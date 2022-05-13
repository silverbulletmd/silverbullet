import { Manifest, RuntimeEnvironment } from "./types";
import { Sandbox } from "./sandbox";
import { System } from "./system";

export class Plug<HookT> {
  system: System<HookT>;
  sandbox: Sandbox;
  public manifest?: Manifest<HookT>;
  readonly runtimeEnv: RuntimeEnvironment;
  grantedPermissions: string[] = [];
  name: string;
  version: number;

  constructor(
    system: System<HookT>,
    name: string,
    sandboxFactory: (plug: Plug<HookT>) => Sandbox
  ) {
    this.system = system;
    this.name = name;
    this.sandbox = sandboxFactory(this);
    this.runtimeEnv = system.runtimeEnv;
    this.version = new Date().getTime();
  }

  async load(manifest: Manifest<HookT>) {
    this.manifest = manifest;
    // TODO: These need to be explicitly granted, not just taken
    this.grantedPermissions = manifest.requiredPermissions || [];
    for (let [dep, code] of Object.entries(manifest.dependencies || {})) {
      await this.sandbox.loadDependency(dep, code);
    }
  }

  syscall(name: string, args: any[]): Promise<any> {
    return this.system.syscallWithContext({ plug: this }, name, args);
  }

  canInvoke(name: string) {
    if (!this.manifest) {
      return false;
    }
    const funDef = this.manifest.functions[name];
    if (!funDef) {
      throw new Error(`Function ${name} not found in manifest`);
    }
    return !funDef.env || funDef.env === this.runtimeEnv;
  }

  async invoke(name: string, args: Array<any>): Promise<any> {
    if (!this.sandbox.isLoaded(name)) {
      const funDef = this.manifest!.functions[name];
      if (!funDef) {
        throw new Error(`Function ${name} not found in manifest`);
      }
      if (!this.canInvoke(name)) {
        throw new Error(
          `Function ${name} is not available in ${this.runtimeEnv}`
        );
      }
      await this.sandbox.load(name, funDef.code!);
    }
    return await this.sandbox.invoke(name, args);
  }

  async stop() {
    this.sandbox.stop();
  }
}

import { Manifest, RuntimeEnvironment } from "./types";
import { Sandbox } from "./sandbox";
import { System } from "./system";

export class Plug<HookT> {
  system: System<HookT>;
  sandbox: Sandbox;
  public manifest?: Manifest<HookT>;
  readonly runtimeEnv: RuntimeEnvironment;

  constructor(system: System<HookT>, name: string, sandbox: Sandbox) {
    this.system = system;
    this.sandbox = sandbox;
    this.runtimeEnv = system.runtimeEnv;
  }

  async load(manifest: Manifest<HookT>) {
    this.manifest = manifest;
    await this.dispatchEvent("load");
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

  async dispatchEvent(name: string, data?: any): Promise<any[]> {
    if (!this.manifest!.hooks?.events) {
      return [];
    }
    let functionsToSpawn = this.manifest!.hooks.events[name];
    if (functionsToSpawn) {
      return await Promise.all(
        functionsToSpawn.map((functionToSpawn: string) => {
          // Only dispatch functions on events when they're allowed to be invoked in this environment
          if (this.canInvoke(functionToSpawn)) {
            return this.invoke(functionToSpawn, [data]);
          } else {
            return Promise.resolve();
          }
        })
      );
    } else {
      return [];
    }
  }

  async stop() {
    this.sandbox.stop();
  }
}

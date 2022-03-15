import { Manifest } from "./types";
// import { WebworkerSandbox } from "./worker_sandbox";

interface SysCallMapping {
  [key: string]: (...args: any) => Promise<any> | any;
}

export interface Sandbox {
  isLoaded(name: string): boolean;
  load(name: string, code: string): Promise<void>;
  invoke(name: string, args: any[]): Promise<any>;
  stop(): void;
}

export class Plug<HookT> {
  system: System<HookT>;
  sandbox: Sandbox;
  public manifest?: Manifest<HookT>;

  constructor(system: System<HookT>, name: string, sandbox: Sandbox) {
    this.system = system;
    this.sandbox = sandbox;
  }

  async load(manifest: Manifest<HookT>) {
    this.manifest = manifest;
    await this.dispatchEvent("load");
  }

  async invoke(name: string, args: Array<any>): Promise<any> {
    if (!this.sandbox.isLoaded(name)) {
      await this.sandbox.load(name, this.manifest!.functions[name].code!);
    }
    return await this.sandbox.invoke(name, args);
  }

  async dispatchEvent(name: string, data?: any): Promise<any[]> {
    let functionsToSpawn = this.manifest!.hooks.events[name];
    if (functionsToSpawn) {
      return await Promise.all(
        functionsToSpawn.map(
          async (functionToSpawn: string) =>
            await this.invoke(functionToSpawn, [data])
        )
      );
    } else {
      return [];
    }
  }

  async stop() {
    this.sandbox.stop();
  }
}

export class System<HookT> {
  protected plugs = new Map<string, Plug<HookT>>();
  registeredSyscalls: SysCallMapping = {};

  registerSyscalls(...registrationObjects: SysCallMapping[]) {
    for (const registrationObject of registrationObjects) {
      for (let p in registrationObject) {
        this.registeredSyscalls[p] = registrationObject[p];
      }
    }
  }

  async syscall(name: string, args: Array<any>): Promise<any> {
    const callback = this.registeredSyscalls[name];
    if (!name) {
      throw Error(`Unregistered syscall ${name}`);
    }
    if (!callback) {
      throw Error(`Registered but not implemented syscall ${name}`);
    }
    return Promise.resolve(callback(...args));
  }

  async load(
    name: string,
    manifest: Manifest<HookT>,
    sandbox: Sandbox
  ): Promise<Plug<HookT>> {
    const plug = new Plug(this, name, sandbox);
    await plug.load(manifest);
    this.plugs.set(name, plug);
    return plug;
  }

  async stop(): Promise<void[]> {
    return Promise.all(
      Array.from(this.plugs.values()).map((plug) => plug.stop())
    );
  }
}

console.log("Starting");

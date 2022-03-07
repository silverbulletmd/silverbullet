import { Manifest } from "./types";

interface SysCallMapping {
  // TODO: Better typing
  [key: string]: any;
}

export class FunctionWorker {
  private worker: Worker;
  private inited: Promise<any>;
  private initCallback: any;
  private invokeResolve?: (result?: any) => void;
  private invokeReject?: (reason?: any) => void;
  private plug: Plug<any>;

  constructor(plug: Plug<any>, name: string, code: string) {
    // let worker = window.Worker;
    this.worker = new Worker(new URL("function_worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = this.onmessage.bind(this);
    this.worker.postMessage({
      type: "boot",
      name: name,
      code: code,
    });
    this.inited = new Promise((resolve) => {
      this.initCallback = resolve;
    });
    this.plug = plug;
  }

  async onmessage(evt: MessageEvent) {
    let data = evt.data;
    if (!data) return;
    switch (data.type) {
      case "inited":
        this.initCallback();
        break;
      case "syscall":
        let result = await this.plug.system.syscall(data.name, data.args);

        this.worker.postMessage({
          type: "syscall-response",
          id: data.id,
          data: result,
        });
        break;
      case "result":
        this.invokeResolve!(data.result);
        break;
      case "error":
        this.invokeReject!(data.reason);
        break;
      default:
        console.error("Unknown message type", data);
    }
  }

  async invoke(args: Array<any>): Promise<any> {
    await this.inited;
    this.worker.postMessage({
      type: "invoke",
      args: args,
    });
    return new Promise((resolve, reject) => {
      this.invokeResolve = resolve;
      this.invokeReject = reject;
    });
  }

  stop() {
    this.worker.terminate();
  }
}

export interface PlugLoader<HookT> {
  load(name: string, manifest: Manifest<HookT>): Promise<void>;
}

export class Plug<HookT> {
  system: System<HookT>;
  private runningFunctions: Map<string, FunctionWorker>;
  public manifest?: Manifest<HookT>;

  constructor(system: System<HookT>, name: string) {
    this.system = system;
    this.runningFunctions = new Map<string, FunctionWorker>();
  }

  async load(manifest: Manifest<HookT>) {
    this.manifest = manifest;
    await this.dispatchEvent("load");
  }

  async invoke(name: string, args: Array<any>): Promise<any> {
    let worker = this.runningFunctions.get(name);
    if (!worker) {
      worker = new FunctionWorker(
        this,
        name,
        this.manifest!.functions[name].code!
      );
      this.runningFunctions.set(name, worker);
    }
    return await worker.invoke(args);
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
    for (const [functionname, worker] of Object.entries(
      this.runningFunctions
    )) {
      console.log(`Stopping ${functionname}`);
      worker.stop();
    }
    this.runningFunctions = new Map<string, FunctionWorker>();
  }
}

export class System<HookT> {
  protected plugs: Map<string, Plug<HookT>>;
  registeredSyscalls: SysCallMapping;

  constructor() {
    this.plugs = new Map<string, Plug<HookT>>();
    this.registeredSyscalls = {};
  }

  registerSyscalls(...registrationObjects: Array<SysCallMapping>) {
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

  async load(name: string, manifest: Manifest<HookT>): Promise<Plug<HookT>> {
    const plug = new Plug(this, name);
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

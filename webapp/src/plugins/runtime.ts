import { Manifest } from "./types";

export class SyscallContext {
  public cartridge: Cartridge;

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
  }
}

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
  private cartridge: Cartridge;

  constructor(cartridge: Cartridge, pathPrefix: string, name: string) {
    // this.worker = new Worker(new URL("function_worker.ts", import.meta.url), {
    //   type: "classic",
    // });
    let worker = window.Worker;
    this.worker = new worker("function_worker.js");

    // console.log("Starting worker", this.worker);
    this.worker.onmessage = this.onmessage.bind(this);
    this.worker.postMessage({
      type: "boot",
      prefix: pathPrefix,
      name: name,
      // @ts-ignore
      userAgent: navigator.userAgent,
    });
    this.inited = new Promise((resolve) => {
      this.initCallback = resolve;
    });
    this.cartridge = cartridge;
  }

  async onmessage(evt: MessageEvent) {
    let data = evt.data;
    if (!data) return;
    switch (data.type) {
      case "inited":
        this.initCallback();
        break;
      case "syscall":
        const ctx = new SyscallContext(this.cartridge);
        let result = await this.cartridge.system.syscall(
          ctx,
          data.name,
          data.args
        );

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

export interface CartridgeLoader {
  load(name: string, manifest: Manifest): Promise<void>;
}

export class Cartridge {
  pathPrefix: string;
  system: System;
  private runningFunctions: Map<string, FunctionWorker>;
  public manifest?: Manifest;
  private name: string;

  constructor(system: System, pathPrefix: string, name: string) {
    this.name = name;
    this.pathPrefix = `${pathPrefix}/${name}`;
    this.system = system;
    this.runningFunctions = new Map<string, FunctionWorker>();
  }

  async load(manifest: Manifest) {
    this.manifest = manifest;
    await this.system.cartridgeLoader.load(this.name, manifest);
    await this.dispatchEvent("load");
  }

  async invoke(name: string, args: Array<any>): Promise<any> {
    if (!this.runningFunctions.has(name)) {
      this.runningFunctions.set(
        name,
        new FunctionWorker(this, this.pathPrefix, name)
      );
    }
    return await this.runningFunctions.get(name)!.invoke(args);
  }

  async dispatchEvent(name: string, data?: any) {
    let functionsToSpawn = this.manifest!.events[name];
    if (functionsToSpawn) {
      await Promise.all(
        functionsToSpawn.map(async (functionToSpawn: string) => {
          await this.invoke(functionToSpawn, [data]);
        })
      );
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

export class System {
  protected cartridges: Map<string, Cartridge>;
  protected pathPrefix: string;
  registeredSyscalls: SysCallMapping;
  cartridgeLoader: CartridgeLoader;

  constructor(cartridgeLoader: CartridgeLoader, pathPrefix: string) {
    this.cartridgeLoader = cartridgeLoader;
    this.pathPrefix = pathPrefix;
    this.cartridges = new Map<string, Cartridge>();
    this.registeredSyscalls = {};
  }

  registerSyscalls(...registrationObjects: Array<SysCallMapping>) {
    for (const registrationObject of registrationObjects) {
      for (let p in registrationObject) {
        this.registeredSyscalls[p] = registrationObject[p];
      }
    }
  }

  async syscall(
    ctx: SyscallContext,
    name: string,
    args: Array<any>
  ): Promise<any> {
    const callback = this.registeredSyscalls[name];
    if (!name) {
      throw Error(`Unregistered syscall ${name}`);
    }
    if (!callback) {
      throw Error(`Registered but not implemented syscall ${name}`);
    }
    return Promise.resolve(callback(ctx, ...args));
  }

  async load(name: string, manifest: Manifest): Promise<Cartridge> {
    const cartridge = new Cartridge(this, this.pathPrefix, name);
    await cartridge.load(manifest);
    this.cartridges.set(name, cartridge);
    return cartridge;
  }

  async stop(): Promise<void[]> {
    return Promise.all(
      Array.from(this.cartridges.values()).map((cartridge) => cartridge.stop())
    );
  }
}

console.log("Starting");

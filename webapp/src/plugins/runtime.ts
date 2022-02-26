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
  private plugin: Plugin;

  constructor(plugin: Plugin, pathPrefix: string, name: string) {
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
    this.plugin = plugin;
  }

  async onmessage(evt: MessageEvent) {
    let data = evt.data;
    if (!data) return;
    switch (data.type) {
      case "inited":
        this.initCallback();
        break;
      case "syscall":
        let result = await this.plugin.system.syscall(data.name, data.args);

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

export interface PluginLoader {
  load(name: string, manifest: Manifest): Promise<void>;
}

export class Plugin {
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
    await this.system.pluginLoader.load(this.name, manifest);
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
  protected plugins: Map<string, Plugin>;
  protected pathPrefix: string;
  registeredSyscalls: SysCallMapping;
  pluginLoader: PluginLoader;

  constructor(PluginLoader: PluginLoader, pathPrefix: string) {
    this.pluginLoader = PluginLoader;
    this.pathPrefix = pathPrefix;
    this.plugins = new Map<string, Plugin>();
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

  async load(name: string, manifest: Manifest): Promise<Plugin> {
    const plugin = new Plugin(this, this.pathPrefix, name);
    await plugin.load(manifest);
    this.plugins.set(name, plugin);
    return plugin;
  }

  async stop(): Promise<void[]> {
    return Promise.all(
      Array.from(this.plugins.values()).map((plugin) => plugin.stop())
    );
  }
}

console.log("Starting");

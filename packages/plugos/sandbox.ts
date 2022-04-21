import { ControllerMessage, WorkerLike, WorkerMessage } from "./environments/worker";
import { Plug } from "./plug";

export type SandboxFactory<HookT> = (plug: Plug<HookT>) => Sandbox;

export class Sandbox {
  protected worker: WorkerLike;
  protected reqId = 0;
  protected outstandingInits = new Map<string, () => void>();
  protected outstandingInvocations = new Map<
    number,
    { resolve: (result: any) => void; reject: (e: any) => void }
  >();
  protected loadedFunctions = new Set<string>();
  protected plug: Plug<any>;

  constructor(plug: Plug<any>, worker: WorkerLike) {
    worker.onMessage = this.onMessage.bind(this);
    this.worker = worker;
    this.plug = plug;
  }

  isLoaded(name: string) {
    return this.loadedFunctions.has(name);
  }

  async load(name: string, code: string): Promise<void> {
    await this.worker.ready;
    let outstandingInit = this.outstandingInits.get(name);
    if (outstandingInit) {
      // Load already in progress, let's wait for it...
      return new Promise((resolve) => {
        this.outstandingInits.set(name, () => {
          outstandingInit!();
          resolve();
        });
      });
    }
    this.worker.postMessage({
      type: "load",
      name: name,
      code: code,
    } as WorkerMessage);
    return new Promise((resolve) => {
      this.outstandingInits.set(name, () => {
        this.loadedFunctions.add(name);
        this.outstandingInits.delete(name);
        resolve();
      });
    });
  }

  async onMessage(data: ControllerMessage) {
    switch (data.type) {
      case "inited":
        let initCb = this.outstandingInits.get(data.name!);
        initCb && initCb();
        this.outstandingInits.delete(data.name!);
        break;
      case "syscall":
        try {
          let result = await this.plug.syscall(data.name!, data.args!);

          this.worker.postMessage({
            type: "syscall-response",
            id: data.id,
            result: result,
          } as WorkerMessage);
        } catch (e: any) {
          // console.error("Syscall fail", e);
          this.worker.postMessage({
            type: "syscall-response",
            id: data.id,
            error: e.message,
          } as WorkerMessage);
        }
        break;
      case "result":
        let resultCbs = this.outstandingInvocations.get(data.id!);
        this.outstandingInvocations.delete(data.id!);
        if (data.error) {
          resultCbs && resultCbs.reject(new Error(data.error));
        } else {
          resultCbs && resultCbs.resolve(data.result);
        }
        break;
      default:
        console.error("Unknown message type", data);
    }
  }

  async invoke(name: string, args: any[]): Promise<any> {
    this.reqId++;
    this.worker.postMessage({
      type: "invoke",
      id: this.reqId,
      name,
      args,
    });
    return new Promise((resolve, reject) => {
      this.outstandingInvocations.set(this.reqId, { resolve, reject });
    });
  }

  stop() {
    this.worker.terminate();
  }
}

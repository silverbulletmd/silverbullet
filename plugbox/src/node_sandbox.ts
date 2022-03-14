import { ControllerMessage, WorkerMessage } from "./types";
import { System, Sandbox } from "./runtime";

import { Worker } from "worker_threads";

function wrapScript(code: string): string {
  return `${code}["default"]`;
}

export class NodeSandbox implements Sandbox {
  worker: Worker;
  private reqId = 0;

  outstandingInits = new Map<string, () => void>();
  outstandingInvocations = new Map<
    number,
    { resolve: (result: any) => void; reject: (e: any) => void }
  >();
  loadedFunctions = new Set<string>();

  constructor(readonly system: System<any>, workerScript: string) {
    this.worker = new Worker(workerScript);

    this.worker.on("message", this.onmessage.bind(this));
  }

  isLoaded(name: string): boolean {
    return this.loadedFunctions.has(name);
  }

  async load(name: string, code: string): Promise<void> {
    this.worker.postMessage({
      type: "load",
      name: name,
      code: code,
    } as WorkerMessage);
    return new Promise((resolve) => {
      this.loadedFunctions.add(name);
      this.outstandingInits.set(name, resolve);
    });
  }

  async onmessage(data: ControllerMessage) {
    // let data = evt.data;
    // let data = JSON.parse(msg) as ControllerMessage;
    switch (data.type) {
      case "inited":
        let initCb = this.outstandingInits.get(data.name!);
        initCb && initCb();
        this.outstandingInits.delete(data.name!);
        break;
      case "syscall":
        let result = await this.system.syscall(data.name!, data.args!);

        this.worker.postMessage({
          type: "syscall-response",
          id: data.id,
          data: result,
        } as WorkerMessage);
        break;
      case "result":
        let resultCb = this.outstandingInvocations.get(data.id!);
        this.outstandingInvocations.delete(data.id!);
        resultCb && resultCb.resolve(data.result);
        break;
      case "error":
        let errCb = this.outstandingInvocations.get(data.result.id!);
        this.outstandingInvocations.delete(data.id!);
        errCb && errCb.reject(data.reason);
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

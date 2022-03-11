import { ControllerMessage, WorkerMessage } from "./types";
import { Plug, Sandbox } from "./runtime";

export class WebworkerSandbox implements Sandbox {
  private worker: Worker;
  private reqId = 0;

  private outstandingInits = new Map<string, () => void>();
  private outstandingInvocations = new Map<
    number,
    { resolve: (result: any) => void; reject: (e: any) => void }
  >();
  private loadedFunctions = new Set<string>();

  constructor(readonly plug: Plug<any>) {
    this.worker = new Worker(new URL("sandbox_worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = this.onmessage.bind(this);
  }

  isLoaded(name: string) {
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

  async onmessage(evt: { data: ControllerMessage }) {
    let data = evt.data;
    if (!data) return;
    switch (data.type) {
      case "inited":
        let initCb = this.outstandingInits.get(data.name!);
        initCb && initCb();
        this.outstandingInits.delete(data.name!);
        break;
      case "syscall":
        let result = await this.plug.system.syscall(data.name!, data.args!);

        this.worker.postMessage({
          type: "syscall-response",
          id: data.id,
          data: result,
        } as WorkerMessage);
        break;
      case "result":
        let resultCb = this.outstandingInvocations.get(data.id!);
        resultCb && resultCb.resolve(data.result);
        break;
      case "error":
        let errCb = this.outstandingInvocations.get(data.result.id!);
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

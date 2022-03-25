import { safeRun } from "../util";
import { Sandbox } from "../sandbox";
import { WorkerLike } from "./worker";
import { Plug } from "../plug";

class WebWorkerWrapper implements WorkerLike {
  private worker: Worker;
  onMessage?: (message: any) => Promise<void>;
  ready: Promise<void>;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener("message", (evt: any) => {
      let data = evt.data;
      if (!data) return;
      safeRun(async () => {
        await this.onMessage!(data);
      });
    });
    this.ready = Promise.resolve();
  }
  postMessage(message: any): void {
    this.worker.postMessage(message);
  }

  terminate() {
    return this.worker.terminate();
  }
}

export function createSandbox(plug: Plug<any>) {
  // ParcelJS will build this file into a worker.
  let worker = new Worker(new URL("sandbox_worker.ts", import.meta.url), {
    type: "module",
  });
  return new Sandbox(plug, new WebWorkerWrapper(worker));
}

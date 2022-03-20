import { ControllerMessage, WorkerLike, WorkerMessage } from "./types";
import { Sandbox, System } from "./runtime";
import { safeRun } from "./util";

class WebWorkerWrapper implements WorkerLike {
  private worker: Worker;
  onMessage?: (message: any) => Promise<void>;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener("message", (evt: any) => {
      let data = evt.data;
      if (!data) return;
      safeRun(async () => {
        await this.onMessage!(data);
      });
    });
  }
  postMessage(message: any): void {
    this.worker.postMessage(message);
  }

  terminate() {
    return this.worker.terminate();
  }
}

export function createSandbox(system: System<any>) {
  // ParcelJS will build this file into a worker.
  let worker = new Worker(new URL("sandbox_worker.ts", import.meta.url), {
    type: "module",
  });
  return new Sandbox(system, new WebWorkerWrapper(worker));
}

import { ControllerMessage, WorkerLike, WorkerMessage } from "./types";
import { System, Sandbox } from "./runtime";

import { Worker } from "worker_threads";
import * as fs from "fs";
import { safeRun } from "./util";

// ParcelJS will simply inline this into the bundle.
const workerCode = fs.readFileSync(__dirname + "/node_worker.js", "utf-8");

class NodeWorkerWrapper implements WorkerLike {
  onMessage?: (message: any) => Promise<void>;
  private worker: Worker;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.on("message", (message: any) => {
      safeRun(async () => {
        await this.onMessage!(message);
      });
    });
  }

  postMessage(message: any): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export function createSandbox(system: System<any>) {
  return new Sandbox(
    system,
    new NodeWorkerWrapper(
      new Worker(workerCode, {
        eval: true,
      })
    )
  );
}

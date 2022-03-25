import { Worker } from "worker_threads";
import { safeRun } from "../util";

// @ts-ignore
import workerCode from "bundle-text:./node_worker.ts";
import { Sandbox } from "../sandbox";
import { WorkerLike } from "./worker";
import { Plug } from "../plug";

class NodeWorkerWrapper implements WorkerLike {
  onMessage?: (message: any) => Promise<void>;
  private worker: Worker;
  ready: Promise<void>;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.on("message", (message: any) => {
      safeRun(async () => {
        await this.onMessage!(message);
      });
    });
    this.ready = new Promise((resolve) => {
      worker.once("online", resolve);
    });
  }

  postMessage(message: any): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export function createSandbox(plug: Plug<any>) {
  let worker = new Worker(workerCode, {
    eval: true,
  });
  return new Sandbox(
    plug,
    new NodeWorkerWrapper(
      new Worker(workerCode, {
        eval: true,
      })
    )
  );
}

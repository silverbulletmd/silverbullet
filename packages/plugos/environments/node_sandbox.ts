import { Worker } from "worker_threads";
import { safeRun } from "../util";

// @ts-ignore
import workerCode from "bundle-text:./node_worker.ts";
import { Sandbox } from "../sandbox";
import { WorkerLike } from "./worker";
import { Plug } from "../plug";
import path from "path";
import fs from "fs";

class NodeWorkerWrapper implements WorkerLike {
  onMessage?: (message: any) => Promise<void>;
  ready: Promise<void>;
  private worker: Worker;

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

// Look for the node_modules directory, to be passed to the worker to find e.g. the vm2 module
export let nodeModulesDir = __dirname;

while (
  !fs.existsSync(nodeModulesDir + "/node_modules/vm2") &&
  nodeModulesDir !== "/"
) {
  nodeModulesDir = path.dirname(nodeModulesDir);
}

export function createSandbox(plug: Plug<any>) {
  let worker = new Worker(workerCode, {
    eval: true,
    workerData: {
      nodeModulesPath: path.join(nodeModulesDir, "node_modules"),
    },
  });
  return new Sandbox(plug, new NodeWorkerWrapper(worker));
}

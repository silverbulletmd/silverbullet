import { safeRun } from "../util.ts";

import { Sandbox } from "../sandbox.ts";
import { WorkerLike } from "./worker.ts";
import { Plug } from "../plug.ts";
import { AssetBundle, assetReadTextFileSync } from "../asset_bundle_reader.ts";

class DenoWorkerWrapper implements WorkerLike {
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

export function sandboxFactory(
  assetBundle: AssetBundle,
): (plug: Plug<any>) => Sandbox {
  return (plug: Plug<any>) => {
    const workerHref = URL.createObjectURL(
      new Blob([
        assetReadTextFileSync(assetBundle, "web/worker.js"),
      ], {
        type: "application/javascript",
      }),
    );
    let worker = new Worker(
      workerHref,
      {
        type: "module",
      },
    );
    return new Sandbox(plug, new DenoWorkerWrapper(worker));
  };
}

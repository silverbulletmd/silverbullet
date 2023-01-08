import { safeRun } from "../util.ts";

import { Sandbox } from "../sandbox.ts";
import { WorkerLike } from "./worker.ts";
import { Plug } from "../plug.ts";
import { AssetBundle } from "../asset_bundle/bundle.ts";

class DenoWorkerWrapper implements WorkerLike {
  private worker: Worker;
  onMessage?: (message: any) => Promise<void>;
  ready: Promise<void>;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener("message", (evt: any) => {
      const data = evt.data;
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

import workerBundleJson from "./worker_bundle.json" assert { type: "json" };

const workerBundle = new AssetBundle(workerBundleJson);

export function createSandbox(plug: Plug<any>) {
  const workerHref = URL.createObjectURL(
    new Blob([
      workerBundle.readFileSync("worker.js"),
    ], {
      type: "application/javascript",
    }),
  );
  const worker = new Worker(
    workerHref,
    {
      type: "module",
      deno: {
        permissions: {
          // Disallow network access
          net: false,
          // This is required for console logging to work, apparently?
          env: true,
          // No talking to native code
          ffi: false,
          // No invocation of shell commands
          run: false,
          // No read access to the file system
          read: false,
          // No write access to the file system
          write: false,
        },
      },
      // Have to do this because the "deno" option is not standard and doesn't typecheck yet
    } as any,
  );
  return new Sandbox(plug, new DenoWorkerWrapper(worker));
}

import { Manifest } from "./types.ts";
import { ControllerMessage, WorkerMessage } from "./protocol.ts";
import { Plug } from "./plug.ts";

export type SandboxFactory<HookT> = (plug: Plug<HookT>) => Sandbox<HookT>;

/**
 * Represents a "safe" execution environment for plug code
 * Effectively this wraps a web worker, the reason to have this split from Plugs is to allow plugs to manage multiple sandboxes, e.g. for performance in the future
 */
export class Sandbox<HookT> {
  private worker?: Worker;
  private reqId = 0;
  private outstandingInvocations = new Map<
    number,
    { resolve: (result: any) => void; reject: (e: any) => void }
  >();

  // public ready: Promise<void>;
  public manifest?: Manifest<HookT>;

  constructor(
    readonly plug: Plug<HookT>,
    private workerOptions = {},
  ) {
  }

  /**
   * Should only invoked lazily (either by invoke, or by a ManifestCache to load the manifest)
   */
  init(): Promise<void> {
    console.log("Booting up worker for", this.plug.name);
    if (this.worker) {
      // Should not happen
      console.warn("Double init of sandbox");
    }
    this.worker = new Worker(this.plug.workerUrl, {
      ...this.workerOptions,
      type: "module",
    });

    return new Promise((resolve) => {
      this.worker!.onmessage = (ev) => {
        if (ev.data.type === "manifest") {
          this.manifest = ev.data.manifest;
          resolve();
          return;
        }

        this.onMessage(ev.data);
      };
    });
  }

  async onMessage(data: ControllerMessage) {
    switch (data.type) {
      case "sys":
        try {
          const result = await this.plug.syscall(data.name!, data.args!);

          this.worker!.postMessage({
            type: "sysr",
            id: data.id,
            result: result,
          } as WorkerMessage);
        } catch (e: any) {
          // console.error("Syscall fail", e);
          this.worker!.postMessage({
            type: "sysr",
            id: data.id,
            error: e.message,
          } as WorkerMessage);
        }
        break;
      case "invr": {
        const resultCbs = this.outstandingInvocations.get(data.id!);
        this.outstandingInvocations.delete(data.id!);
        if (data.error) {
          resultCbs &&
            resultCbs.reject(new Error(data.error));
        } else {
          resultCbs && resultCbs.resolve(data.result);
        }
        break;
      }
      default:
        console.error("Unknown message type", data);
    }
  }

  async invoke(name: string, args: any[]): Promise<any> {
    if (!this.worker) {
      // Lazy initialization
      await this.init();
    }
    this.reqId++;
    this.worker!.postMessage({
      type: "inv",
      id: this.reqId,
      name,
      args,
    } as WorkerMessage);
    return new Promise((resolve, reject) => {
      this.outstandingInvocations.set(this.reqId, { resolve, reject });
    });
  }

  stop() {
    if (this.worker) {
      this.worker.terminate();
    }
  }
}

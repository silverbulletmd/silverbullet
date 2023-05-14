import { Manifest } from "./types.ts";
import type { LogLevel } from "./environments/custom_logger.ts";
import { ControllerMessage, WorkerMessage } from "./environments/worker.ts";
import { Plug } from "./plug.ts";

export type SandboxFactory<HookT> = (plug: Plug<any>) => Sandbox;

export type LogEntry = {
  level: LogLevel;
  message: string;
  date: number;
};

export class Sandbox {
  protected worker: Worker;
  protected reqId = 0;
  protected outstandingDependencyInits = new Map<string, () => void>();
  protected outstandingInvocations = new Map<
    number,
    { resolve: (result: any) => void; reject: (e: any) => void }
  >();
  protected loadedFunctions = new Set<string>();
  public logBuffer: LogEntry[] = [];
  public maxLogBufferSize = 100;
  public manifest: Promise<Manifest<any>>;

  constructor(
    readonly plug: Plug<any>,
    workerOptions = {},
  ) {
    const blob = new Blob([plug.workerCode], { type: "text/javascript" });
    this.worker = new Worker(URL.createObjectURL(blob), {
      ...workerOptions,
      type: "module",
    });
    this.manifest = new Promise((resolve) => {
      this.worker.onmessage = (ev) => {
        if (ev.data.type === "inited") {
          resolve(ev.data.manifest);
          return;
        }

        this.onMessage(ev.data);
      };
    });
  }

  async onMessage(data: ControllerMessage) {
    switch (data.type) {
      case "syscall":
        try {
          const result = await this.plug.syscall(data.name!, data.args!);

          this.worker.postMessage({
            type: "syscall-response",
            id: data.id,
            result: result,
          } as WorkerMessage);
        } catch (e: any) {
          // console.error("Syscall fail", e);
          this.worker.postMessage({
            type: "syscall-response",
            id: data.id,
            error: e.message,
          } as WorkerMessage);
        }
        break;
      case "result": {
        const resultCbs = this.outstandingInvocations.get(data.id!);
        this.outstandingInvocations.delete(data.id!);
        if (data.error) {
          resultCbs &&
            resultCbs.reject(
              new Error(`${data.error}\nStack trace: ${data.stack}`),
            );
        } else {
          resultCbs && resultCbs.resolve(data.result);
        }
        break;
      }
      case "log": {
        this.log(data.level!, data.message!);
        break;
      }
      default:
        console.error("Unknown message type", data);
    }
  }

  log(level: string, ...messageBits: any[]) {
    const message = messageBits.map((a) => "" + a).join(" ");
    this.logBuffer.push({
      message,
      level: level as LogLevel,
      date: Date.now(),
    });
    if (this.logBuffer.length > this.maxLogBufferSize) {
      this.logBuffer.shift();
    }
    console.log(`[Sandbox ${level}]`, message);
  }

  invoke(name: string, args: any[]): Promise<any> {
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

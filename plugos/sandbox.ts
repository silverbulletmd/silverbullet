import type { LogLevel } from "./environments/custom_logger.ts";
import {
  ControllerMessage,
  WorkerLike,
  WorkerMessage,
} from "./environments/worker.ts";
import { Plug } from "./plug.ts";

export type SandboxFactory<HookT> = (plug: Plug<HookT>) => Sandbox;

export type LogEntry = {
  level: LogLevel;
  message: string;
  date: number;
};

export class Sandbox {
  protected worker: WorkerLike;
  protected reqId = 0;
  protected outstandingInits = new Map<string, () => void>();
  protected outstandingDependencyInits = new Map<string, () => void>();
  protected outstandingInvocations = new Map<
    number,
    { resolve: (result: any) => void; reject: (e: any) => void }
  >();
  protected loadedFunctions = new Set<string>();
  protected plug: Plug<any>;
  public logBuffer: LogEntry[] = [];
  public maxLogBufferSize = 100;

  constructor(plug: Plug<any>, worker: WorkerLike) {
    worker.onMessage = this.onMessage.bind(this);
    this.worker = worker;
    this.plug = plug;
  }

  isLoaded(name: string) {
    return this.loadedFunctions.has(name);
  }

  async load(name: string, code: string): Promise<void> {
    await this.worker.ready;
    const outstandingInit = this.outstandingInits.get(name);
    if (outstandingInit) {
      // Load already in progress, let's wait for it...
      return new Promise((resolve) => {
        this.outstandingInits.set(name, () => {
          outstandingInit!();
          resolve();
        });
      });
    }
    this.worker.postMessage({
      type: "load",
      name: name,
      code: code,
    } as WorkerMessage);
    return new Promise((resolve) => {
      this.outstandingInits.set(name, () => {
        this.loadedFunctions.add(name);
        this.outstandingInits.delete(name);
        resolve();
      });
    });
  }

  loadDependency(name: string, code: string): Promise<void> {
    // console.log("Loading dependency", name);
    this.worker.postMessage({
      type: "load-dependency",
      name: name,
      code: code,
    } as WorkerMessage);
    return new Promise((resolve) => {
      // console.log("Loaded dependency", name);
      this.outstandingDependencyInits.set(name, () => {
        this.outstandingDependencyInits.delete(name);
        resolve();
      });
    });
  }

  async onMessage(data: ControllerMessage) {
    switch (data.type) {
      case "inited": {
        const initCb = this.outstandingInits.get(data.name!);
        initCb && initCb();
        this.outstandingInits.delete(data.name!);
        break;
      }
      case "dependency-inited": {
        const depInitCb = this.outstandingDependencyInits.get(data.name!);
        depInitCb && depInitCb();
        this.outstandingDependencyInits.delete(data.name!);
        break;
      }
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
        this.logBuffer.push({
          level: data.level!,
          message: data.message!,
          date: Date.now(),
        });
        if (this.logBuffer.length > this.maxLogBufferSize) {
          this.logBuffer.shift();
        }
        console.log(`[Sandbox ${data.level}]`, data.message);
        break;
      }
      default:
        console.error("Unknown message type", data);
    }
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

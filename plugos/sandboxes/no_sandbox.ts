import { PromiseQueue } from "$sb/lib/async.ts";
import { Plug } from "../plug.ts";
import { Sandbox } from "./sandbox.ts";
import { Manifest } from "../types.ts";

// We need to hard inject the syscall function into the global scope
declare global {
  interface globalThis {
    syscall(name: string, ...args: any[]): Promise<any>;
  }
}

export type PlugExport<HookT> = {
  manifest: Manifest<HookT>;
  functionMapping: Record<string, Function>;
};

const functionQueue = new PromiseQueue();

let activePlug: Plug<any> | undefined;

// @ts-ignore: globalThis
globalThis.syscall = (name: string, ...args: any[]): Promise<any> => {
  if (!activePlug) {
    throw new Error("No active plug");
  }
  console.log("Calling syscall", name, args);
  return activePlug.syscall(name, args);
};

export class NoSandbox<HookT> implements Sandbox<HookT> {
  manifest?: Manifest<HookT> | undefined;
  constructor(
    private plug: Plug<HookT>,
    private plugExport: PlugExport<HookT>,
  ) {
    this.manifest = plugExport.manifest;
    plug.manifest = this.manifest;
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  invoke(name: string, args: any[]): Promise<any> {
    activePlug = this.plug;
    return functionQueue.runInQueue(async () => {
      try {
        const fn = this.plugExport.functionMapping[name];
        if (!fn) {
          throw new Error(`Function not loaded: ${name}`);
        }
        return await fn(...args);
      } finally {
        activePlug = undefined;
      }
    });
  }

  stop() {
  }
}

export function noSandboxFactory<HookT>(
  plugExport: PlugExport<HookT>,
): (plug: Plug<HookT>) => Sandbox<HookT> {
  return (plug: Plug<HookT>) => new NoSandbox(plug, plugExport);
}

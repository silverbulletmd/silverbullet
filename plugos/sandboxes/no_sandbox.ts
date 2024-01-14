import { PromiseQueue } from "$sb/lib/async.ts";
import { Plug } from "../plug.ts";
import { Sandbox } from "./sandbox.ts";
import { Manifest } from "../types.ts";
import { System } from "../system.ts";

// We need to hard inject the syscall function into the global scope
declare global {
  interface globalThis {
    syscall(name: string, ...args: any[]): Promise<any>;
  }
}

export type PlugExport<HookT> = {
  manifest: Manifest<HookT>;
  // @ts-ignore: Function whatever
  functionMapping: Record<string, Function>;
};

let activeSystem:
  | System<any>
  | undefined;

// @ts-ignore: globalThis
globalThis.syscall = (name: string, ...args: any[]): Promise<any> => {
  if (!activeSystem) {
    throw new Error("No currently active system, can't invoke syscalls");
  }
  return activeSystem.syscall(name, args);
};

const taskQueue = new PromiseQueue();

export function runWithSystemLock(
  system: System<any>,
  fn: () => Promise<any>,
): Promise<any> {
  return taskQueue.runInQueue(async () => {
    // Set the global active system, which is used by the syscall function
    activeSystem = system;
    try {
      // Run the logic
      return await fn();
    } finally {
      // And then reset the global active system
      activeSystem = undefined;
    }
  });
}

/**
 * Executes a plug in a no-sandbox environment
 * This requires there either to only be a single System to be active at a given time (set via setGlobalActiveNoSandboxSystem).
 * If multiple systems need to be supported, requests should be run in sequence, never in parallel
 */
export class NoSandbox<HookT> implements Sandbox<HookT> {
  manifest?: Manifest<HookT> | undefined;
  constructor(
    readonly plug: Plug<HookT>,
    readonly plugExport: PlugExport<HookT>,
  ) {
    this.manifest = plugExport.manifest;
    plug.manifest = this.manifest;
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  async invoke(name: string, args: any[]): Promise<any> {
    const fn = this.plugExport.functionMapping[name];
    if (!fn) {
      throw new Error(`Function not loaded: ${name}`);
    }
    return await fn(...args);
  }

  stop() {
  }
}

export function noSandboxFactory<HookT>(
  plugExport: PlugExport<HookT>,
): (plug: Plug<HookT>) => Sandbox<HookT> {
  return (plug: Plug<HookT>) => new NoSandbox(plug, plugExport);
}

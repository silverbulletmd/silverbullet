import { PromiseQueue } from "$sb/lib/async.ts";
import { Plug } from "../plug.ts";
import { Sandbox } from "./sandbox.ts";
import { Manifest } from "../types.ts";
import { System } from "../system.ts";

/**
 * This implements a "no sandbox" sandbox that actually runs code the main thread, without any isolation.
 * This is useful for (often serverless) environments like CloudFlare workers and Deno Deploy that do not support workers.
 * Since these environments often also don't allow dynamic loading (or even eval'ing) of code, plug code needs to be
 * imported as a regular ESM module (which is possible).
 *
 * To make this work, a global `syscall` function needs to be injected into the global scope.
 * Since a syscall relies on a System, we need to track the active System in a global variable.
 * The issue with this is that it means that only a single System can be active at a given time per JS process.
 * To enforce this, we have a runWithSystemLock function that can be used to run code in a System-locked context, effectively queuing the execution of tasks sequentially.
 * This isn't great, but it's the best we can do.
 *
 * Luckily, in the only contexts in which you need to run plugs this way are serverless, where code will be
 * run in a bunch of isolates with hopefully low parallelism of requests per isolate.
 */

/**
 * A type representing the `plug` export of a plug, used via e.g. `import { plug } from "./some.plug.js`
 */
export type PlugExport = {
  manifest: Manifest<any>;
  functionMapping: Record<string, (...args: any[]) => any>;
};

// The global variable tracking the currently active system (if any)
let activeSystem:
  | System<any>
  | undefined;

// We need to hard inject the syscall function into the global scope
declare global {
  interface globalThis {
    syscall(name: string, ...args: any[]): Promise<any>;
  }
}
// @ts-ignore: globalThis
globalThis.syscall = (name: string, ...args: any[]): Promise<any> => {
  if (!activeSystem) {
    throw new Error(`No currently active system, can't invoke syscall ${name}`);
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
    readonly plugExport: PlugExport,
  ) {
    this.manifest = plugExport.manifest;
    plug.manifest = this.manifest;
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  invoke(name: string, args: any[]): Promise<any> {
    const fn = this.plugExport.functionMapping[name];
    if (!fn) {
      throw new Error(`Function not defined: ${name}`);
    }
    return Promise.resolve(fn(...args));
  }

  stop() {
    // Nothing to do
  }
}

// Matches the createSandbox signature wrapping a PlugExport
export function noSandboxFactory(
  plugExport: PlugExport,
): (plug: Plug<any>) => Sandbox<any> {
  return (plug: Plug<any>) => new NoSandbox(plug, plugExport);
}

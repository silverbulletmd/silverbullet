import { Plug } from "../plug.ts";
import { Sandbox } from "./sandbox.ts";
import { Manifest } from "../types.ts";
import { System } from "../system.ts";
import { SandboxFactory } from "./sandbox.ts";
import { PromiseQueue } from "../../async.ts";

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
 * Values of this type are passed into the `noSandboxFactory` function when called on a system.load
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
  // Invoke syscall with no active plug set (because we don't know which plug is invoking the syscall)
  return activeSystem.syscall({}, name, args);
};

// Global sequential task queue for running tasks in a System-locked context
const taskQueue = new PromiseQueue();

/**
 * Schedules a task to run in a System-locked context
 * in effect this will ensure only one such context is active at a given time allowing for no parallelism
 * @param system to activate while running the task
 * @param task callback to run
 * @returns the result of the task once it completes
 */
export function runWithSystemLock(
  system: System<any>,
  task: () => Promise<any>,
): Promise<any> {
  return taskQueue.runInQueue(async () => {
    // Set the global active system, which is used by the syscall function
    activeSystem = system;
    try {
      // Run the logic, note putting the await here is crucial to make sure the `finally` block runs at the right time
      return await task();
    } finally {
      // And then reset the global active system whether the thing blew up or not
      activeSystem = undefined;
    }
  });
}

/**
 * Implements a no-sandbox sandbox that runs code in the main thread
 */
export class NoSandbox<HookT> implements Sandbox<HookT> {
  manifest: Manifest<HookT>;

  constructor(
    readonly plug: Plug<HookT>,
    readonly plugExport: PlugExport,
  ) {
    this.manifest = plugExport.manifest;
    plug.manifest = this.manifest;
  }

  init(): Promise<void> {
    // Nothing to do
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

export function createSandbox<HookT>(
  plugExport: PlugExport,
): SandboxFactory<HookT> {
  return (plug: Plug<any>) => new NoSandbox(plug, plugExport);
}

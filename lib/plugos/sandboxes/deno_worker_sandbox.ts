import { WorkerSandbox } from "./worker_sandbox.ts";
import type { SandboxFactory } from "./sandbox.ts";

// Uses Deno's permissions to lock the worker down significantly
export function createSandbox<HookT>(workerUrl: URL): SandboxFactory<HookT> {
  return (plug) =>
    new WorkerSandbox(plug, workerUrl, {
      deno: {
        permissions: {
          // Allow network access
          net: true,
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
    });
}

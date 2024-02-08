import { WorkerSandbox } from "./worker_sandbox.ts";
import type { Plug } from "../plug.ts";
import type { SandboxFactory } from "./sandbox.ts";

export function createSandbox<HookT>(workerUrl: URL): SandboxFactory<HookT> {
  return (plug: Plug<HookT>) => new WorkerSandbox(plug, workerUrl);
}

import { WorkerSandbox } from "./worker_sandbox.ts";
import type { Plug } from "../plug.ts";
import { Sandbox } from "./sandbox.ts";

export function createSandbox<HookT>(plug: Plug<HookT>): Sandbox<HookT> {
  return new WorkerSandbox(plug);
}

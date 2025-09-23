import { WorkerSandbox } from "./worker_sandbox.ts";
import type { Plug } from "../plug.ts";
import type { SandboxFactory } from "./sandbox.ts";
import { fsEndpoint } from "../../spaces/constants.ts";

export function createWorkerSandboxFromLocalPath<HookT>(
  name: string,
): SandboxFactory<HookT> {
  return (plug: Plug<HookT>) =>
    new WorkerSandbox(
      plug,
      new URL(
        name,
        document.baseURI.slice(0, -1) + fsEndpoint + "/", // We're NOT striping trailing '/', this used to be `location.origin`
      ),
    );
}

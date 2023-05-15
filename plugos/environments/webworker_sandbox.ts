import { Sandbox } from "../sandbox.ts";
import type { Plug } from "../plug.ts";

export function createSandbox<HookT>(plug: Plug<HookT>): Sandbox<HookT> {
  return new Sandbox(plug);
}

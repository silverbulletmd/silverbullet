import { Sandbox } from "../sandbox.ts";
import type { Plug } from "../plug.ts";

export function createSandbox(plug: Plug<any>): Sandbox {
  return new Sandbox(plug);
}

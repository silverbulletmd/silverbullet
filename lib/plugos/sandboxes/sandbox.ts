import type { Plug } from "../plug.ts";
import type { Manifest } from "../types.ts";

export type SandboxFactory<HookT> = (plug: Plug<HookT>) => Sandbox<HookT>;

export interface Sandbox<HookT> {
  manifest?: Manifest<HookT>;
  init(): Promise<void>;
  invoke(name: string, args: any[]): Promise<any>;
  stop(): void;
}

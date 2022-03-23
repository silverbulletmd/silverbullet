import { System } from "./system";

export interface Manifest<HookT> {
  hooks: HookT & EventHook;
  functions: {
    [key: string]: FunctionDef;
  };
}

export interface FunctionDef {
  path?: string;
  code?: string;
  env?: RuntimeEnvironment;
}

export type RuntimeEnvironment = "client" | "server";

export type EventHook = {
  events?: { [key: string]: string[] };
};

export interface Feature<HookT> {
  validateManifest(manifest: Manifest<HookT>): string[];

  apply(system: System<HookT>): void;
}

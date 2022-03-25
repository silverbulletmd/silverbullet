import { System } from "./system";

export interface Manifest<HookT> {
  requiredPermissions?: string[];
  hooks: HookT;
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

export interface Feature<HookT> {
  validateManifest(manifest: Manifest<HookT>): string[];

  apply(system: System<HookT>): void;
}

import { System } from "./system";

export interface Manifest<HookT> {
  requiredPermissions?: string[];
  functions: {
    [key: string]: FunctionDef<HookT>;
  };
}

export type FunctionDef<HookT> = {
  path?: string;
  code?: string;
  env?: RuntimeEnvironment;
} & HookT;

export type RuntimeEnvironment = "client" | "server";

export interface Hook<HookT> {
  validateManifest(manifest: Manifest<HookT>): string[];

  apply(system: System<HookT>): void;
}

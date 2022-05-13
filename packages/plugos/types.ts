import { System } from "./system";

export interface Manifest<HookT> {
  name: string;
  requiredPermissions?: string[];
  dependencies?: {
    [key: string]: string;
  };
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

import { System } from "./system.ts";
import { AssetJson } from "./asset_bundle/bundle.ts";

export interface Manifest<HookT> {
  name: string;
  requiredPermissions?: string[];
  assets?: string[] | AssetJson;
  functions: {
    [key: string]: FunctionDef<HookT>;
  };
}

export type FunctionDef<HookT> = {
  // Read the function from this path and inline it
  // Format: filename:functionName
  path?: string;
  // Reuse an
  // Format: plugName.functionName
  redirect?: string;
  env?: RuntimeEnvironment;
} & HookT;

export type RuntimeEnvironment = "client" | "server";

export interface Hook<HookT> {
  validateManifest(manifest: Manifest<HookT>): string[];
  apply(system: System<HookT>): void;
}

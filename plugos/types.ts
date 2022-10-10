import { AssetBundle } from "../plugos/asset_bundle_reader.ts";
import { System } from "./system.ts";

export interface Manifest<HookT> {
  name: string;
  requiredPermissions?: string[];
  assets?: string[] | AssetBundle;
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

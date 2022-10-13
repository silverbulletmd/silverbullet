import { System } from "./system.ts";
import { AssetJson } from "./asset_bundle/bundle.ts";

export interface Manifest<HookT> {
  name: string;
  requiredPermissions?: string[];
  // URLs to plugs whose dependencies are presumed to already be loaded (main use case: global.plug.json)
  imports?: string[];
  assets?: string[] | AssetJson;
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

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

/** Associates hooks with a function */
export type FunctionDef<HookT> = {
  /** A function path, in the form `${relativeFilename}:${functionName}`, that attached to the given hooks.
   * 
   * During compilation (see @{link ../build_plugs.ts}) the function is read from the file and inlined into the plug bundle.
   * 
   * This field and @{link FunctionDef.redirect} are mutually exclusive/
   */
  path?: string;

  /** A function from another plug, in the form `${plugName}.${functionName}` that will be attached to the given hooks. */
  redirect?: string;

  /** Environments where this plug is allowed to run, current may be one of "cli", "server", or "client". */
  env?: string;
} & HookT;

export interface Hook<HookT> {
  validateManifest(manifest: Manifest<HookT>): string[];
  apply(system: System<HookT>): void;
}

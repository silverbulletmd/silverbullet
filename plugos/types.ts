import { System } from "./system.ts";
import { AssetJson } from "./asset_bundle/bundle.ts";

/** The generic top level of a plug manifest file.
 * Defines plug metadata and functions.
 */
export interface Manifest<HookT> {
  /** The plug's name. Typically this matches ${plugName} in the manifest file name. */
  name: string;

  /** A list of syscall permissions required for this plug to function.
   * 
   * Possible values:
   * - `fetch`: enables `fetch` function.
   * - `shell`: enables {@link ../plug-api/plugos-syscall/shell.ts#run}.
   */
  requiredPermissions?: string[];

  /** A list of files or glob patterns that should be bundled with the plug.
   * 
   * These files will be accessible through the {@link ../plug-api/plugos-syscall/asset.ts#readAsset} function.
   */
  assets?: string[] | AssetJson;

  /** A map of function names to definitions. Declared functions are public, and may be associated with {@link ../manifest.ts#SilverBulletHooks} */
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

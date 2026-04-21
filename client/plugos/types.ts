import type { System } from "./system.ts";
import type { AssetJson } from "../asset_bundle/bundle.ts";

/** The generic top level of a plug manifest file.
 * Defines plug metadata and functions.
 */
export interface Manifest<HookT> {
  /** The plug's name. Typically this is the name of the manifest file, without the file extension. */
  name: string;

  /** A list of syscall permissions required for this plug to function.
   *
   * Possible values:
   * - `fetch`: enables `fetch` function. (see: plug-api/plugos-syscall/fetch.ts, and plug-api/lib/fetch.ts)
   * - `shell`: enables the `shell.run` syscall. (see: plug-api/plugos-syscall/shell.ts)
   */
  requiredPermissions?: string[];

  /** A list of files or glob patterns that should be bundled with the plug.
   *
   * These files will be accessible through the `asset.readAsset` function.
   *
   * see: plug-api/plugos-syscall/asset.ts#readAsset
   */
  assets?: string[] | AssetJson;

  /** A map of function names to definitions. Declared functions are public, and may be associated with various hooks
   *
   * see: common/manifest.ts#SilverBulletHooks
   */
  functions: Record<string, FunctionDef<HookT>>;

  /**
   * A map of configuration options for the plug (to be merged with the system configuration).
   */
  config?: any;

  /** Build steps run before asset bundling. Each step transforms an `in` file
   * into an `out` file, which is then picked up by the `assets` glob.
   *
   * Currently only `type: "esbuild"` is supported (the default when omitted),
   * which runs esbuild in bundle mode on `in` and writes the result to `out`.
   */
  build?: BuildStep[];
}

/** A pre-asset-bundling transformation, e.g. bundling a TypeScript entry point
 * into a single JS file that is then loaded from plug assets.
 *
 * Supported types:
 *   - `esbuild` (default): bundle `in` into `out` as a minified browser IIFE.
 *   - `sass`: compile an SCSS/SASS file at `in` to CSS at `out`.
 *   - `copy`: copy `in` verbatim to `out`.
 */
export interface BuildStep {
  /** Transformation type. Defaults to "esbuild" when omitted. */
  type?: "esbuild" | "sass" | "copy";
  /** Input path relative to the manifest. */
  in: string;
  /** Output path relative to the manifest. */
  out: string;
}

/** Associates hooks with a function. This is the generic base structure, that identifies the function. Hooks are defined by the type parameter. */
export type FunctionDef<HookT> = {
  /** A function path, in the form `${relativeFilename}:${functionName}`.
   *
   * During compilation (see `../build_plugs.ts`) the function is read from the file and inlined into the plug bundle.
   *
   * This field and `FunctionDef.redirect` are mutually exclusive.
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

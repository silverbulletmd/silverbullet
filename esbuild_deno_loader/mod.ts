import {
  esbuild,
  ImportMap,
  resolveImportMap,
  resolveModuleSpecifier,
  toFileUrl,
} from "./deps.ts";
import { load as nativeLoad } from "./src/native_loader.ts";
import { load as portableLoad } from "./src/portable_loader.ts";
import { ModuleEntry } from "./src/deno.ts";
import { resolve } from "https://deno.land/std@0.122.0/path/win32.ts";

export interface DenoPluginOptions {
  /**
   * Specify the URL to an import map to use when resolving import specifiers.
   * The URL must be fetchable with `fetch`.
   */
  importMapURL?: URL;
  /**
   * Specify which loader to use. By default this will use the `native` loader,
   * unless `Deno.run` is not available.
   *
   * - `native`:     Shells out to the Deno execuatble under the hood to load
   *                 files. Requires --allow-read and --allow-run.
   * - `portable`:   Do module downloading and caching with only Web APIs.
   *                 Requires --allow-net.
   */
  loader?: "native" | "portable";
}

/** The default loader to use. */
export const DEFAULT_LOADER: "native" | "portable" =
  typeof Deno.run === "function" ? "native" : "portable";

export function denoPlugin(options: DenoPluginOptions = {}): esbuild.Plugin {
  const loader = options.loader ?? DEFAULT_LOADER;
  return {
    name: "deno",
    setup(build) {
      const infoCache = new Map<string, ModuleEntry>();
      let importMap: ImportMap | null = null;

      build.onStart(async function onStart() {
        if (options.importMapURL !== undefined) {
          const resp = await fetch(options.importMapURL.href);
          const txt = await resp.text();
          importMap = resolveImportMap(JSON.parse(txt), options.importMapURL);
        } else {
          importMap = null;
        }
      });

      build.onResolve(
        { filter: /.*/ },
        function onResolve(
          args: esbuild.OnResolveArgs,
        ): esbuild.OnResolveResult | null | undefined {
          // console.log("To resolve", args.path);
          const resolveDir = args.resolveDir
            ? `${toFileUrl(args.resolveDir).href}/`
            : "";
          const referrer = args.importer || resolveDir;
          let resolved: URL;
          if (importMap !== null) {
            const res = resolveModuleSpecifier(
              args.path,
              importMap,
              new URL(referrer) || undefined,
            );
            resolved = new URL(res);
          } else {
            resolved = new URL(args.path, referrer);
          }
          // console.log("Resolved", resolved.href);
          if (build.initialOptions.external) {
            for (const external of build.initialOptions.external) {
              if (resolved.href.startsWith(external)) {
                // console.log("Got external", args.path, resolved.href);
                return { path: resolved.href, external: true };
              }
            }
          }
          const href = resolved.href;
          // Don't use the deno loader for any of the specific loader file extensions
          const loaderExts = Object.keys(build.initialOptions.loader || {});
          for (const ext of loaderExts) {
            if (href.endsWith(ext)) {
              return {
                path: resolved.href.substring("file://".length),
              };
            }
          }
          return { path: resolved.href, namespace: "deno" };
        },
      );

      build.onLoad(
        { filter: /.*/ },
        function onLoad(
          args: esbuild.OnLoadArgs,
        ): Promise<esbuild.OnLoadResult | null> {
          if (args.path.endsWith(".css")) {
            return Promise.resolve(null);
          }
          const url = new URL(args.path);
          switch (loader) {
            case "native":
              return nativeLoad(infoCache, url, options);
            case "portable":
              return portableLoad(url, options);
          }
        },
      );
    },
  };
}

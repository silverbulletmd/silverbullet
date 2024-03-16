import { compileManifests } from "./compile.ts";
import * as esbuild from "esbuild";

export async function plugCompileCommand(
  { watch, dist, debug, info, importmap, runtimeUrl }: {
    watch: boolean;
    dist: string;
    debug: boolean;
    info: boolean;
    importmap?: string;
    runtimeUrl?: string;
  },
  ...manifestPaths: string[]
) {
  await compileManifests(
    manifestPaths,
    dist,
    watch,
    {
      debug: debug,
      info: info,
      runtimeUrl,
      importMap: importmap
        ? new URL(importmap, `file://${Deno.cwd()}/`).toString()
        : undefined,
    },
  );
  esbuild.stop();
  Deno.exit(0);
}

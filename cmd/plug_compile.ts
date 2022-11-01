import { bundleRun } from "../plugos/bin/plugos-bundle.ts";
import { esbuild } from "../plugos/compile.ts";

export async function plugCompileCommand(
  { watch, dist, debug, info, importmap }: {
    watch: boolean;
    dist: string;
    debug: boolean;
    info: boolean;
    importmap?: string;
  },
  ...manifestPaths: string[]
) {
  console.log("All optiosn", arguments);
  await bundleRun(
    manifestPaths,
    dist,
    watch,
    {
      debug: debug,
      info: info,
      importMap: importmap
        ? new URL(importmap, `file://${Deno.cwd()}/`)
        : undefined,
    },
  );
  esbuild.stop();
}

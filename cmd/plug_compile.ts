import { compileManifests } from "../plugos/compile.ts";
import { esbuild } from "../plugos/deps.ts";

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
  await compileManifests(
    manifestPaths,
    dist,
    watch,
    {
      debug: debug,
      info: info,
      importMap: importmap
        ? new URL(importmap, `file://${Deno.cwd()}/`).toString()
        : undefined,
    },
  );
  esbuild.stop();
}

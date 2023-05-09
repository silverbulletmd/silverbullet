import { expandGlobSync, flags, path } from "./plugos/deps.ts";
import { bundleRun } from "./plugos/bin/plugos-bundle.ts";
import { esbuild } from "./plugos/compile.ts";
import { bundle as plugOsBundle } from "./plugos/bin/plugos-bundle.ts";

if (import.meta.main) {
  const args = flags.parse(Deno.args, {
    boolean: ["debug", "watch", "reload", "info"],
    alias: { w: "watch" },
  });

  const manifests = [];
  const pattern: string = path.join("plugs", "*", "*.plug.yaml");
  for (const file of expandGlobSync(pattern)) {
    manifests.push(file.path);
  }

  const targetDir = path.join("dist_plug_bundle", "_plug");
  Deno.mkdir(targetDir, { recursive: true });

  // First build global plug
  const globalManifest = await plugOsBundle("./plugs/global.plug.yaml");
  await Deno.writeTextFile(
    `dist_plug_bundle/global.plug.json`,
    JSON.stringify(globalManifest, null, 2),
  );

  // Build the other plugs
  await bundleRun(
    manifests,
    targetDir,
    args.watch,
    {
      debug: args.debug,
      reload: args.reload,
      info: args.info,
    },
  );
  esbuild.stop();
}

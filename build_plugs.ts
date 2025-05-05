import * as path from "@std/path";
import * as esbuild from "esbuild";
import { compileManifests } from "./cmd/compile.ts";
import { builtinPlugNames } from "./plugs/builtin_plugs.ts";
import { parseArgs } from "@std/cli/parse-args";
import { fileURLToPath } from "node:url";
import { updateVersionFile } from "./update_version.ts";

await updateVersionFile();

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["debug", "watch", "reload", "info"],
    alias: { w: "watch" },
  });

  const manifests = builtinPlugNames.map((name) =>
    `./plugs/${name}/${name}.plug.yaml`
  );

  const plugBundlePath = "dist_plug_bundle";
  const targetDir = path.join(plugBundlePath, "_plug");
  Deno.mkdirSync(targetDir, { recursive: true });
  Deno.mkdirSync("dist", { recursive: true });

  // Build the other plugs
  await compileManifests(
    manifests,
    targetDir,
    args.watch,
    {
      debug: args.debug,
      reload: args.reload,
      info: args.info,
      configPath: fileURLToPath(new URL("deno.json", import.meta.url)),
    },
  );
  esbuild.stop();
}

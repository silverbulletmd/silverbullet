import * as path from "@std/path";
import * as esbuild from "esbuild";
import { compileManifests } from "./lib/plugos/plug_compile.ts";
import { builtinPlugNames } from "./plugs/builtin_plugs.ts";
import { parseArgs } from "@std/cli/parse-args";
import { fileURLToPath } from "node:url";
import { copy } from "@std/fs";
import { version } from "./version.ts";

// This builds all built-in plugs and libraries and puts them into dist_base_fs_bundle/

if (import.meta.main) {
  await updateVersionFile();
  const args = parseArgs(Deno.args, {
    boolean: ["debug", "reload", "info"],
    alias: { w: "watch" },
  });

  const manifests = builtinPlugNames.map((name) =>
    `./plugs/${name}/${name}.plug.yaml`
  );

  const plugBundlePath = "dist_base_fs_bundle";
  const targetDir = path.join(plugBundlePath, "_plug");
  Deno.mkdirSync(targetDir, { recursive: true });
  Deno.mkdirSync("dist", { recursive: true });

  // Copy Library files
  await copy("libraries/Library", "dist_base_fs_bundle/Library", {
    overwrite: true,
  });

  // Build the plugs
  await compileManifests(
    manifests,
    targetDir,
    {
      debug: args.debug,
      info: args.info,
      configPath: fileURLToPath(new URL("deno.json", import.meta.url)),
    },
  );
  esbuild.stop();
}

export async function updateVersionFile() {
  const command = new Deno.Command("git", {
    args: ["describe", "--tags", "--long"],
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout } = await command.output();
  let commitVersion = new TextDecoder().decode(stdout).trim();

  if (!commitVersion) {
    // Probably no valid .git repo, fallback to GITHUB_SHA env var (used in CI)
    commitVersion = `${version}-${Deno.env.get("GITHUB_SHA") || "unknown"}`;
  }

  const versionFilePath = "./public_version.ts";
  const versionContent = `export const publicVersion = "${commitVersion}";`;

  await Deno.writeTextFile(versionFilePath, versionContent);
  console.log(
    `Updated public_version.ts with version information: ${commitVersion}`,
  );
}

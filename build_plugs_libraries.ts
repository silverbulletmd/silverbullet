import * as path from "@std/path";
import { esbuild } from "./build_deps.ts";
import { compileManifests } from "./client/plugos/plug_compile.ts";
import { builtinPlugNames } from "./plugs/builtin_plugs.ts";
import { parseArgs } from "@std/cli/parse-args";
import { fileURLToPath } from "node:url";
import { copy } from "@std/fs";
import { version } from "./version.ts";

// This builds all built-in plugs and libraries and puts them into client_bundle/base_fs

if (import.meta.main) {
  await updateVersionFile();
  const args = parseArgs(Deno.args, {
    boolean: ["debug", "reload", "info"],
    alias: { w: "watch" },
  });

  const manifests = builtinPlugNames.map((name) =>
    `./plugs/${name}/${name}.plug.yaml`
  );

  const plugBundlePath = "client_bundle/base_fs";
  const targetDir = path.join(plugBundlePath, "Library", "Std", "Plugs");
  Deno.mkdirSync(targetDir, { recursive: true });
  Deno.mkdirSync("dist", { recursive: true });

  // Copy Library files
  await copy("libraries/Library", `${plugBundlePath}/Library`, {
    overwrite: true,
  });
  await copy("libraries/Repositories", `${plugBundlePath}/Repositories`, {
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

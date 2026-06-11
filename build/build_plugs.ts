import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { cp } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { compileManifests } from "../client/plugos/plug_compile.ts";
import { builtinPlugNames } from "../plugs/builtin_plugs.ts";
import { updateVersionFile } from "./version.ts";

// This builds all built-in plugs and libraries and puts them into client_bundle/base_fs

export async function buildPlugsAndLibraries(options?: {
  debug?: boolean;
  info?: boolean;
}): Promise<void> {
  const manifests = builtinPlugNames.map(
    (name) => `./plugs/${name}/${name}.plug.yaml`,
  );

  const plugBundlePath = "client_bundle/base_fs";
  const targetDir = join(plugBundlePath, "Library", "Std", "Plugs");
  mkdirSync(targetDir, { recursive: true });
  mkdirSync("dist", { recursive: true });

  // Copy Library files
  await cp("libraries/Library", `${plugBundlePath}/Library`, {
    recursive: true,
  });
  await cp("libraries/Repositories", `${plugBundlePath}/Repositories`, {
    recursive: true,
  });

  // Build the plugs
  await compileManifests(manifests, targetDir, {
    debug: options?.debug,
    info: options?.info,
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      debug: { type: "boolean" },
      info: { type: "boolean" },
    },
    strict: false,
  });

  await updateVersionFile();
  await buildPlugsAndLibraries({
    debug: args.debug as boolean | undefined,
    info: args.info as boolean | undefined,
  });
  await esbuild.stop();
}

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { cp, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as esbuild from "esbuild";

import { compileManifests } from "../client/plugos/plug_compile.ts";
import { builtinPlugNames } from "../plugs/builtin_plugs.ts";
import { version } from "../version.ts";

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

export function updateVersionFile(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const gitProcess = spawn("git", ["describe", "--tags", "--long"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";

    gitProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    gitProcess.on("close", async (code) => {
      let commitVersion = stdout.trim();

      if (!commitVersion || code !== 0) {
        // Probably no valid .git repo, fallback to GITHUB_SHA env var (used in CI)
        commitVersion = `${version}-${process.env.GITHUB_SHA || "unknown"}`;
      }

      const versionFilePath = "./public_version.ts";
      // Write version to file with date in YYYY-MM-DDTHH-MM-SSZ format attached to the version
      const versionContent = `export const publicVersion = "${commitVersion}-${new Date()
        .toISOString()
        .split(".")[0]
        .replaceAll(":", "-")
        .concat("Z")}";`;

      try {
        await writeFile(versionFilePath, versionContent, "utf-8");
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    gitProcess.on("error", reject);
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

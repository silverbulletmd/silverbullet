import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

export async function buildCli(): Promise<void> {
  await mkdir("dist", { recursive: true });

  const result = await esbuild.build({
    entryPoints: ["./bin/silverbullet-cli.ts"],
    outfile: "dist/silverbullet-cli.js",
    format: "esm",
    banner: {
      js: "#!/usr/bin/env node",
    },
    platform: "node",
    absWorkingDir: process.cwd(),
    bundle: true,
    metafile: false,
    treeShaking: true,
    logLevel: "error",
    minify: false,
    external: ["commander"],
  });
  if (result.metafile) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info", text);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await buildCli();
  await esbuild.stop();
}

import picomatch from "picomatch";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import mime from "mime";

import { AssetBundle } from "./bundle.ts";

async function* walk(dir: string): AsyncGenerator<{ path: string }> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield { path: fullPath };
    }
  }
}

export async function bundleAssets(
  rootPath: string,
  patterns: string[],
): Promise<AssetBundle> {
  const bundle = new AssetBundle();
  if (patterns.length === 0) {
    return bundle;
  }
  const isMatch = picomatch(patterns);
  for await (
    const file of walk(rootPath)
  ) {
    const cleanPath = file.path.substring(rootPath.length + 1);
    // console.log("Considering", rootPath, file.path, cleanPath);
    if (isMatch(cleanPath)) {
      bundle.writeFileSync(
        cleanPath,
        mime.getType(cleanPath) || "application/octet-stream",
        await readFile(file.path),
      );
    }
  }
  return bundle;
}

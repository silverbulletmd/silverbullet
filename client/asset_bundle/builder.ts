import { readFile, readdir } from "node:fs/promises";
import { join, matchesGlob } from "node:path";
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
  for await (const file of walk(rootPath)) {
    const cleanPath = file.path.substring(rootPath.length + 1);
    if (patterns.some((p) => matchesGlob(cleanPath, p))) {
      bundle.writeFileSync(
        cleanPath,
        mime.getType(cleanPath) || "application/octet-stream",
        await readFile(file.path),
      );
    }
  }
  return bundle;
}

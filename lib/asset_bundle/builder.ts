// import { globToRegExp, mime, path, walk } from "../deps_server.ts";
import { dirname, globToRegExp } from "@std/path";
import { AssetBundle } from "./bundle.ts";
import { walk } from "@std/fs";
import { mime } from "mimetypes";

export async function bundleAssets(
  rootPath: string,
  patterns: string[],
): Promise<AssetBundle> {
  const bundle = new AssetBundle();
  if (patterns.length === 0) {
    return bundle;
  }
  const matchRegexes = patterns.map((pat) => globToRegExp(pat));
  for await (
    const file of walk(rootPath)
  ) {
    const cleanPath = file.path.substring(rootPath.length + 1);
    let match = false;
    // console.log("Considering", rootPath, file.path, cleanPath);
    for (const matchRegex of matchRegexes) {
      if (matchRegex.test(cleanPath)) {
        match = true;
        break;
      }
    }
    if (match) {
      bundle.writeFileSync(
        cleanPath,
        mime.getType(cleanPath) || "application/octet-stream",
        await Deno.readFile(file.path),
      );
    }
  }
  return bundle;
}

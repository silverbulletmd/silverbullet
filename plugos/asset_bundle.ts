import { mime } from "../server/deps.ts";
import { AssetBundle } from "./asset_bundle_reader.ts";
import { base64Encode } from "./base64.ts";
import { globToRegExp, path, walk } from "./deps.ts";

export async function bundleAssets(
  rootPath: string,
  patterns: string[],
): Promise<AssetBundle> {
  const bundle: AssetBundle = {};
  for await (
    const file of walk(rootPath, {
      match: patterns.map((pat) => globToRegExp(pat)),
    })
  ) {
    await loadIntoBundle(file.path, "", bundle);
  }
  return bundle;
}

export async function bundleFolder(rootPath: string, bundlePath: string) {
  const bundle: AssetBundle = {};
  await Deno.mkdir(path.dirname(bundlePath), { recursive: true });
  for await (
    const { path: filePath } of walk(rootPath, { includeDirs: false })
  ) {
    console.log("Bundling", filePath);
    await loadIntoBundle(filePath, `${rootPath}/`, bundle);
  }
  await Deno.writeTextFile(bundlePath, JSON.stringify(bundle, null, 2));
}

async function loadIntoBundle(
  filePath: string,
  rootPath: string,
  bundle: AssetBundle,
) {
  const b64content = base64Encode(await Deno.readFile(filePath));
  const s = await Deno.stat(filePath);
  const cleanPath = filePath.substring(rootPath.length);
  bundle[cleanPath] = {
    meta: {
      name: cleanPath,
      contentType: mime.getType(cleanPath) || "application/octet-stream",
      size: s.size,
      lastModified: s.mtime!.getTime(),
      perm: "ro",
    },
    data: b64content,
  };
}

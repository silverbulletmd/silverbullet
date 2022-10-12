import { globToRegExp, path, walk } from "../deps.ts";
import { AssetBundle } from "./bundle.ts";

export async function bundleAssets(
  rootPath: string,
  patterns: string[],
): Promise<AssetBundle> {
  const bundle = new AssetBundle();
  for await (
    const file of walk(rootPath, {
      match: patterns.map((pat) => globToRegExp(pat)),
    })
  ) {
    const cleanPath = file.path.substring("".length);
    await bundle.writeFileSync(cleanPath, await Deno.readFile(file.path));
  }
  return bundle;
}

export async function bundleFolder(rootPath: string, bundlePath: string) {
  const bundle = new AssetBundle();
  await Deno.mkdir(path.dirname(bundlePath), { recursive: true });
  for await (
    const { path: filePath } of walk(rootPath, { includeDirs: false })
  ) {
    console.log("Bundling", filePath);
    const cleanPath = filePath.substring(`${rootPath}/`.length);
    await bundle.writeFileSync(cleanPath, await Deno.readFile(filePath));
  }
  await Deno.writeTextFile(
    bundlePath,
    JSON.stringify(bundle.toJSON(), null, 2),
  );
}

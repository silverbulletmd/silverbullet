import { b64decode } from "../../dep_common.ts";

type AssetBundle = Record<string, string>;

export function assetReadFileSync(
  bundle: AssetBundle,
  path: string,
): ArrayBuffer {
  const content = bundle[path];
  if (!content) {
    throw new Error(`No such file ${path}`);
  }
  return b64decode(content);
}

export function assetReadTextFileSync(
  bundle: AssetBundle,
  path: string,
): string {
  return new TextDecoder().decode(assetReadFileSync(bundle, path));
}

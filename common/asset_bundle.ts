import { base64Decode } from "./base64.ts";
import { FileMeta } from "./types.ts";

export type AssetBundle = Record<string, { meta: FileMeta; data: string }>;

export function assetReadFileSync(
  bundle: AssetBundle,
  path: string,
): ArrayBuffer {
  const content = bundle[path];
  if (!content) {
    throw new Error(`No such file ${path}`);
  }
  return base64Decode(content.data);
}

export function assetStatSync(
  bundle: AssetBundle,
  path: string,
): FileMeta {
  const content = bundle[path];
  if (!content) {
    throw new Error(`No such file ${path}`);
  }
  return content.meta;
}

export function assetReadTextFileSync(
  bundle: AssetBundle,
  path: string,
): string {
  return new TextDecoder().decode(assetReadFileSync(bundle, path));
}

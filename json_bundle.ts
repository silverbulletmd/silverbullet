import { walk } from "https://deno.land/std@0.159.0/fs/mod.ts";
import { base64Encode } from "./packages/common/base64.ts";

export async function bundleFolder(path: string, bundlePath: string) {
  const bundle: Record<string, string> = {};
  for await (const { path: filePath } of walk(path, { includeDirs: false })) {
    console.log("Bundling", filePath);
    const b64content = base64Encode(await Deno.readFile(filePath));
    bundle[filePath] = b64content;
  }
  await Deno.writeTextFile(bundlePath, JSON.stringify(bundle, null, 2));
}

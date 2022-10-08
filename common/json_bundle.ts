import { walk } from "https://deno.land/std@0.159.0/fs/mod.ts";
import { base64Encode } from "./base64.ts";
import { path } from "./deps.ts";

export async function bundleFolder(p: string, bundlePath: string) {
  const bundle: Record<string, string> = {};
  await Deno.mkdir(path.dirname(bundlePath), { recursive: true });
  for await (const { path: filePath } of walk(p, { includeDirs: false })) {
    console.log("Bundling", filePath);
    const b64content = base64Encode(await Deno.readFile(filePath));
    bundle[filePath.substring(p.length + 1)] = b64content;
  }
  await Deno.writeTextFile(bundlePath, JSON.stringify(bundle, null, 2));
}

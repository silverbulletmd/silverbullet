import { walk } from "https://deno.land/std@0.159.0/fs/mod.ts";
import { mime } from "../server/deps.ts";
import { AssetBundle } from "./asset_bundle.ts";
import { base64Encode } from "./base64.ts";
import { path } from "./deps.ts";

export async function bundleFolder(p: string, bundlePath: string) {
  const bundle: AssetBundle = {};
  await Deno.mkdir(path.dirname(bundlePath), { recursive: true });
  for await (const { path: filePath } of walk(p, { includeDirs: false })) {
    console.log("Bundling", filePath);
    const b64content = base64Encode(await Deno.readFile(filePath));
    const s = await Deno.stat(filePath);
    const cleanPath = filePath.substring(p.length + 1);
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
  await Deno.writeTextFile(bundlePath, JSON.stringify(bundle, null, 2));
}

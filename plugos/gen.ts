import { AssetBundle } from "./asset_bundle/bundle.ts";
import { compile } from "./compile.ts";
const bundlePath =
  new URL("./environments/worker_bundle.json", import.meta.url).pathname;
const workerPath =
  new URL("./environments/sandbox_worker.ts", import.meta.url).pathname;

const workerCode = await compile(workerPath);

const assetBundle = new AssetBundle();
assetBundle.writeTextFileSync("worker.js", workerCode);
Deno.writeTextFile(
  bundlePath,
  JSON.stringify(assetBundle.toJSON(), null, 2),
);

console.log(`Wrote updated bundle to ${bundlePath}`);
Deno.exit(0);

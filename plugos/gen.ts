import { AssetBundle } from "./asset_bundle/bundle.ts";
import { compile } from "./compile.ts";

console.log("Generating sandbox worker...");
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

console.log("Now generating SQLite worker...");
const sqliteBundlePath =
  new URL("./sqlite/worker_bundle.json", import.meta.url).pathname;
const sqliteWorkerPath =
  new URL("./sqlite/worker.ts", import.meta.url).pathname;

const sqliteWorkerCode = await compile(sqliteWorkerPath);

const sqliteAssetBundle = new AssetBundle();
sqliteAssetBundle.writeTextFileSync("worker.js", sqliteWorkerCode);
Deno.writeTextFile(
  sqliteBundlePath,
  JSON.stringify(sqliteAssetBundle.toJSON(), null, 2),
);

console.log(`Wrote updated bundle to ${sqliteBundlePath}`);
Deno.exit(0);

import { runPlug } from "../cli/plug_run.ts";
import { path } from "../common/deps.ts";
import assets from "../dist/plug_asset_bundle.json" assert {
  type: "json",
};
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { silverBulletDbFile } from "./constants.ts";

export async function plugRunCommand(
  {
    db,
    hostname,
    port,
  }: {
    db?: string;
    hostname?: string;
    port?: number;
  },
  spacePath: string,
  functionName: string | undefined,
  ...args: string[]
) {
  spacePath = path.resolve(spacePath);
  console.log("Space path", spacePath);
  let dbPath = path.resolve(spacePath, silverBulletDbFile);
  if (db) {
    dbPath = path.resolve(db);
  }
  console.log("Function to run:", functionName, "with arguments", args);
  try {
    const result = await runPlug(
      spacePath,
      dbPath,
      functionName,
      args,
      new AssetBundle(assets),
      port,
      hostname,
    );
    if (result) {
      console.log("Output", result);
    }
    Deno.exit(0);
  } catch (e: any) {
    console.error(e.message);
    Deno.exit(1);
  }
}

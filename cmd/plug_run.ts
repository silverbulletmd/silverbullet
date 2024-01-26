import { runPlug } from "../cli/plug_run.ts";
import { path } from "../common/deps.ts";
import assets from "../dist/plug_asset_bundle.json" assert {
  type: "json",
};
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { determineDatabaseBackend } from "../server/db_backend.ts";

export async function plugRunCommand(
  {
    hostname,
    port,
  }: {
    hostname?: string;
    port?: number;
  },
  spacePath: string,
  functionName: string | undefined,
  ...args: string[]
) {
  spacePath = path.resolve(spacePath);
  console.log("Space path", spacePath);
  console.log("Function to run:", functionName, "with arguments", args);

  const kvPrimitives = await determineDatabaseBackend(spacePath);

  if (!kvPrimitives) {
    console.error("Cannot run plugs in databaseless mode.");
    return;
  }

  try {
    const result = await runPlug(
      spacePath,
      functionName,
      args,
      new AssetBundle(assets),
      kvPrimitives,
      port,
      hostname,
    );
    if (result) {
      console.log("Output", result);
    }
    kvPrimitives.close();
    Deno.exit(0);
  } catch (e: any) {
    console.error(e.message);
    Deno.exit(1);
  }
}

import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";

import { sleep } from "$sb/lib/async.ts";
import { ServerSystem } from "../server/server_system.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import { determineDatabaseBackend } from "../server/db_backend.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { determineShellBackend } from "../server/shell_backend.ts";
import { Hono } from "../server/deps.ts";

export async function runPlug(
  spacePath: string,
  functionName: string | undefined,
  args: string[] = [],
  builtinAssetBundle: AssetBundle,
  httpServerPort = 3123,
  httpHostname = "127.0.0.1",
) {
  const serverController = new AbortController();
  const app = new Hono();

  const dbBackend = await determineDatabaseBackend(spacePath);

  if (!dbBackend) {
    console.error("Cannot run plugs in databaseless mode.");
    return;
  }

  const endpointHook = new EndpointHook("/_/");

  const serverSystem = new ServerSystem(
    new AssetBundlePlugSpacePrimitives(
      new DiskSpacePrimitives(spacePath),
      builtinAssetBundle,
    ),
    dbBackend,
    determineShellBackend(spacePath),
  );
  await serverSystem.init(true);
  app.use((context, next) => {
    return endpointHook.handleRequest(serverSystem.system!, context, next);
  });
  Deno.serve({
    hostname: httpHostname,
    port: httpServerPort,
    signal: serverController.signal,
  }, app.fetch);

  if (functionName) {
    const [plugName, funcName] = functionName.split(".");

    const plug = serverSystem.system.loadedPlugs.get(plugName);
    if (!plug) {
      throw new Error(`Plug ${plugName} not found`);
    }
    const result = await plug.invoke(funcName, args);
    await serverSystem.close();
    serverSystem.kvPrimitives.close();
    serverController.abort();
    return result;
  } else {
    console.log("Running in server mode, use Ctrl-c to stop");
    while (true) {
      await sleep(1000);
    }
  }
}

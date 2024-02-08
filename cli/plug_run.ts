import { DiskSpacePrimitives } from "$common/spaces/disk_space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";

import { ServerSystem } from "../server/server_system.ts";
import { AssetBundlePlugSpacePrimitives } from "$common/spaces/asset_bundle_space_primitives.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { LocalShell } from "../server/shell_backend.ts";
import { Hono } from "../server/deps.ts";
import { KvPrimitives } from "$lib/kv_primitives.ts";
import { DataStore } from "$lib/datastore.ts";
import { DataStoreMQ } from "$lib/mq.datastore.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { sleep } from "$lib/async.ts";

export async function runPlug(
  spacePath: string,
  functionName: string | undefined,
  args: string[] = [],
  builtinAssetBundle: AssetBundle,
  kvPrimitives: KvPrimitives,
  httpServerPort?: number,
  httpHostname?: string,
) {
  const serverController = new AbortController();
  const app = new Hono();

  const endpointHook = new EndpointHook("/_/");

  const ds = new DataStore(kvPrimitives);
  const mq = new DataStoreMQ(ds);
  const eventHook = new EventHook();

  const serverSystem = new ServerSystem(
    new AssetBundlePlugSpacePrimitives(
      new DiskSpacePrimitives(spacePath),
      builtinAssetBundle,
    ),
    kvPrimitives,
    new LocalShell(spacePath),
    mq,
    ds,
    eventHook,
    false,
    true,
  );
  await serverSystem.init(true);
  app.use((context, next) => {
    return endpointHook.handleRequest(serverSystem.system!, context, next);
  });
  if (httpHostname && httpServerPort) {
    Deno.serve({
      hostname: httpHostname,
      port: httpServerPort,
      signal: serverController.signal,
    }, app.fetch);
  }

  if (functionName) {
    const result = await serverSystem.system.invokeFunction(functionName, args);
    await serverSystem.close();
    serverController.abort();
    return result;
  } else {
    console.log("Running in server mode, use Ctrl-c to stop");
    while (true) {
      await sleep(1000);
    }
  }
}

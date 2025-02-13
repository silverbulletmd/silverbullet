import { resolve } from "@std/path";
import assets from "../dist/plug_asset_bundle.json" with { type: "json" };
import { determineDatabaseBackend } from "../server/db_backend.ts";
import { DiskSpacePrimitives } from "$common/spaces/disk_space_primitives.ts";

import { ServerSystem } from "../server/server_system.ts";
import { AssetBundlePlugSpacePrimitives } from "$common/spaces/asset_bundle_space_primitives.ts";
import { LocalShell } from "../server/shell_backend.ts";
import { DataStore } from "$lib/data/datastore.ts";
import { DataStoreMQ } from "$lib/data/mq.datastore.ts";
import { EventHook } from "../common/hooks/event.ts";
import { AssetBundle } from "$lib/asset_bundle/bundle.ts";
import {
  type ConfigContainer,
  defaultConfig,
} from "@silverbulletmd/silverbullet/type/config";
import { parse } from "$common/space_lua/parse.ts";
import { LuaRuntimeError, LuaStackFrame } from "$common/space_lua/runtime.ts";

import { evalStatement } from "$common/space_lua/eval.ts";

export async function luaRunCommand(
  _options: any,
  spacePath: string,
  scriptPath: string,
) {
  spacePath = resolve(spacePath);
  console.log("Space path", spacePath);
  console.log("Script to run:", scriptPath);

  const kvPrimitives = await determineDatabaseBackend(spacePath);

  if (!kvPrimitives) {
    console.error("Cannot run plugs in databaseless mode.");
    return;
  }

  try {
    const ds = new DataStore(kvPrimitives);
    const mq = new DataStoreMQ(ds);
    const eventHook = new EventHook();
    // TODO: Actually load config from the space
    const configContainer: ConfigContainer = {
      config: defaultConfig,
      loadConfig: () => Promise.resolve(),
    };

    const serverSystem = new ServerSystem(
      new AssetBundlePlugSpacePrimitives(
        new DiskSpacePrimitives(spacePath),
        new AssetBundle(assets),
      ),
      kvPrimitives,
      new LocalShell(spacePath),
      mq,
      ds,
      eventHook,
      false,
      true,
      configContainer,
    );
    await serverSystem.init(false, false);
    // Then evaluate it
    const luaFile = await Deno.readTextFile(scriptPath);
    const chunk = parse(luaFile, {});
    const env = serverSystem.spaceLuaEnv.env;
    const sf = LuaStackFrame.createWithGlobalEnv(env, chunk.ctx);

    try {
      await evalStatement(chunk, env, sf);
    } catch (e: any) {
      if (e instanceof LuaRuntimeError) {
        console.error(`Error evaluating script:`, e.toPrettyString(luaFile));
      } else {
        console.error(`Error evaluating script:`, e);
      }
    }
    kvPrimitives.close();
    Deno.exit(0);
  } catch (e: any) {
    console.error(e.message);
    Deno.exit(1);
  }
}

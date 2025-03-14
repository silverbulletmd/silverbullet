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
import { Input } from "@cliffy/prompt";

export async function luaReplCommand(
  _options: any,
  spacePath: string,
) {
  spacePath = resolve(spacePath);
  console.log("Space path", spacePath);

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
    await serverSystem.init(true, false);
    const env = serverSystem.spaceLuaEnv.env;

    console.log(`
=====================
SilverBullet Lua REPL
=====================
Type Lua expressions or statements to evaluate them");
Type 'exit' or press Ctrl+C to exit");
For multi-line input, end a line with '\\'`);

    // Start the REPL loop
    let input = "";
    let multilineBuffer = "";

    Deno.addSignalListener("SIGINT", () => {
      console.log("Exiting");
      kvPrimitives.close();
      Deno.exit(0);
    });

    while (true) {
      const promptPrefix = multilineBuffer ? ">>" : ">";
      const promptResult = await Input.prompt({
        message: promptPrefix,
        suggestions: (_input) => {
          // TODO: Make this fancier
          return env.keys();
        },
        prefix: "",
        pointer: "",
        cbreak: true,
      });

      // Handle exit command
      if (promptResult === "exit" && !multilineBuffer) {
        break;
      }

      // Check if this is a continuation line (ends with backslash)
      if (promptResult.endsWith("\\")) {
        // Add to multiline buffer (without the backslash)
        multilineBuffer += promptResult.slice(0, -1) + "\n";
        continue;
      }

      // Combine multiline buffer with current input
      input = multilineBuffer + promptResult;
      multilineBuffer = ""; // Reset buffer

      // Skip empty lines
      if (input.trim() === "") {
        continue;
      }

      try {
        // Try parsing as an expression first
        try {
          const printStatementAST = parse(`print(${input})`, {});
          const sf = LuaStackFrame.createWithGlobalEnv(
            env,
            printStatementAST.ctx,
          );
          await evalStatement(printStatementAST, env, sf);
        } catch (e: any) {
          if (e.message.includes("Parse error")) {
            const statementAST = parse(input, {});
            // Not an expression, try as a statement
            const sf = LuaStackFrame.createWithGlobalEnv(env, statementAST.ctx);
            await evalStatement(statementAST, env, sf);
          } else {
            throw e;
          }
        }
      } catch (e) {
        if (e instanceof LuaRuntimeError) {
          console.error(`Error: ${e.toPrettyString(input)}`);
        } else if (e instanceof Error) {
          console.error(`Error: ${e.message}`);
        } else {
          console.error(`Error: ${String(e)}`);
        }
      }
    }
    console.log("Exiting");
    kvPrimitives.close();
    Deno.exit(0);
  } catch (e: any) {
    console.error(e.message);
    Deno.exit(1);
  }
}

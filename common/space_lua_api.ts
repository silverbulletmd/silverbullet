import { luaBuildStandardEnv } from "$common/space_lua/stdlib.ts";
import { parsePageRef } from "@silverbulletmd/silverbullet/lib/page_ref";
import {
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaEnv,
  LuaNativeJSFunction,
  LuaTable,
} from "$common/space_lua/runtime.ts";
import type { System } from "$lib/plugos/system.ts";
import type { ScriptEnvironment } from "$common/space_script.ts";
import type { CommandDef } from "$lib/command.ts";

export function buildLuaEnv(system: System<any>, scriptEnv: ScriptEnvironment) {
  const env = new LuaEnv(luaBuildStandardEnv());

  // Expose all syscalls to Lua
  exposeSyscalls(env, system);
  // Support defining commands and subscriptions from Lua
  exposeDefinitions(env, system, scriptEnv);

  return env;
}

function exposeSyscalls(env: LuaEnv, system: System<any>) {
  // Expose all syscalls to Lua
  for (const syscallName of system.registeredSyscalls.keys()) {
    const [ns, fn] = syscallName.split(".");
    if (!env.get(ns)) {
      env.set(ns, new LuaTable());
    }
    const luaFn = new LuaNativeJSFunction((...args) => {
      return system.localSyscall(syscallName, args);
    });
    // Register the function with the same name as the syscall both in regular and snake_case
    env.get(ns).set(fn, luaFn);
    env.get(ns).set(snakeCase(fn), luaFn);
  }
}

function exposeDefinitions(
  env: LuaEnv,
  system: System<any>,
  scriptEnv: ScriptEnvironment,
) {
  const defApi = new LuaTable();
  env.set("def", defApi);
  // Expose the command registration function to Lua via def.command({name="foo", function() ... end})
  defApi.set(
    "command",
    new LuaBuiltinFunction(
      (def: LuaTable) => {
        if (def.get(1) === undefined) {
          throw new Error("Callback is required");
        }
        if (!def.get("name")) {
          throw new Error("Name is required");
        }
        console.log("Registering Lua command", def.get("name"));
        scriptEnv.registerCommand(
          {
            name: def.get("name"),
            key: def.get("key"),
            mac: def.get("mac"),
            priority: def.get("priority"),
            requireMode: def.get("require_mode"),
            hide: def.get("hide"),
          } as CommandDef,
          async (...args: any[]) => {
            try {
              return await def.get(1).call(
                ...args.map(jsToLuaValue),
              );
            } catch (e: any) {
              await handleLuaError(e, system);
            }
          },
        );
      },
    ),
  );
  defApi.set(
    "event_listener",
    new LuaBuiltinFunction((def: LuaTable) => {
      if (def.get(1) === undefined) {
        throw new Error("Callback is required");
      }
      if (!def.get("event")) {
        throw new Error("Event is required");
      }
      console.log("Subscribing to Lua event", def.get("event"));
      scriptEnv.registerEventListener(
        { name: def.get("event") },
        async (...args: any[]) => {
          try {
            return await def.get(1).call(
              ...args.map(jsToLuaValue),
            );
          } catch (e: any) {
            await handleLuaError(e, system);
          }
        },
      );
    }),
  );
}

async function handleLuaError(e: any, system: System<any>) {
  console.error(
    "Lua eval exception",
    e.message,
    e.context,
  );
  if (e.context && e.context.ref) {
    // We got an error and actually know where it came from, let's navigate there to help debugging
    const pageRef = parsePageRef(e.context.ref);
    await system.localSyscall(
      "editor.flashNotification",
      [
        `Lua error: ${e.message}`,
        "error",
      ],
    );
    await system.localSyscall(
      "editor.flashNotification",
      [
        `Navigating to the place in the code where this error occurred in ${pageRef.page}`,
        "info",
      ],
    );
    await system.localSyscall("editor.navigate", [
      {
        page: pageRef.page,
        pos: pageRef.pos + e.context.from +
          "```space-lua\n".length,
      },
    ]);
  }
}

function snakeCase(s: string) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

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

export function buildLuaEnv(system: System<any>, scriptEnv: ScriptEnvironment) {
  const env = new LuaEnv(luaBuildStandardEnv());

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

  // Expose the command registration function to Lua
  env.set(
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
          def.asJSObject() as any,
          async (...args: any[]) => {
            try {
              return await def.get(1).call(
                ...args.map(jsToLuaValue),
              );
            } catch (e: any) {
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
          },
        );
      },
    ),
  );
  return env;
}

function snakeCase(s: string) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

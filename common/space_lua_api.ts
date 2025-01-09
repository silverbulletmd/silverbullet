import { luaBuildStandardEnv } from "$common/space_lua/stdlib.ts";
import { parsePageRef } from "@silverbulletmd/silverbullet/lib/page_ref";
import {
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
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
  const nativeFs = new LuaStackFrame(env, null);
  for (const syscallName of system.registeredSyscalls.keys()) {
    const [ns, fn] = syscallName.split(".");
    if (!env.has(ns)) {
      env.set(ns, new LuaTable(), nativeFs);
    }
    const luaFn = new LuaNativeJSFunction((...args) => {
      return system.localSyscall(syscallName, args);
    });
    // Register the function with the same name as the syscall both in regular and snake_case
    env.get(ns, nativeFs).set(fn, luaFn, nativeFs);
    env.get(ns, nativeFs).set(snakeCase(fn), luaFn, nativeFs);
  }
}

function exposeDefinitions(
  env: LuaEnv,
  system: System<any>,
  scriptEnv: ScriptEnvironment,
) {
  // Expose the command registration function to Lua via define_command({name="foo", function() ... end})
  env.set(
    "define_command",
    new LuaBuiltinFunction(
      (_sf, def: LuaTable) => {
        if (def.get(1) === undefined) {
          throw new Error("Callback is required");
        }
        if (!def.get("name")) {
          throw new Error("Name is required");
        }
        const fn = def.get(1);
        console.log(
          `[Lua] Registering command '${
            def.get("name")
          }' (source: ${fn.body.ctx.ref})`,
        );
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
            const tl = await buildThreadLocalEnv(system, env);
            const sf = new LuaStackFrame(tl, null);
            try {
              return await fn.call(sf, ...args.map(jsToLuaValue));
            } catch (e: any) {
              await handleLuaError(e, system);
            }
          },
        );
      },
    ),
  );
  env.set(
    "define_event_listener",
    new LuaBuiltinFunction((_sf, def: LuaTable) => {
      if (def.get(1) === undefined) {
        throw new Error("Callback is required");
      }
      if (!def.get("event")) {
        throw new Error("Event is required");
      }
      const fn = def.get(1);
      console.log(
        `[Lua] Subscribing to event '${
          def.get("event")
        }' (source: ${fn.body.ctx.ref})`,
      );
      scriptEnv.registerEventListener(
        { name: def.get("event") },
        async (...args: any[]) => {
          const tl = await buildThreadLocalEnv(system, env);
          const sf = new LuaStackFrame(tl, null);
          try {
            return await fn.call(sf, ...args.map(jsToLuaValue));
          } catch (e: any) {
            await handleLuaError(e, system);
          }
        },
      );
    }),
  );
}

async function buildThreadLocalEnv(system: System<any>, globalEnv: LuaEnv) {
  const tl = new LuaEnv();
  const currentPageMeta = await system.localSyscall(
    "editor.getCurrentPageMeta",
    [],
  );
  tl.setLocal("pageMeta", currentPageMeta);
  tl.setLocal("_GLOBAL", globalEnv);
  return tl;
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

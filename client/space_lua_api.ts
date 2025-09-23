import { luaBuildStandardEnv } from "./space_lua/stdlib.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaNativeJSFunction,
  type LuaRuntimeError,
  LuaStackFrame,
  LuaTable,
} from "./space_lua/runtime.ts";
import type { System } from "./plugos/system.ts";
import { resolveASTReference } from "./space_lua.ts";

export function buildLuaEnv(system: System<any>) {
  const env = new LuaEnv(luaBuildStandardEnv());

  // Expose all syscalls to Lua
  exposeSyscalls(env, system);

  return env;
}

/**
 * Exposes all registered syscalls to Lua, automatically converting Lua arguments to JS values
 * If a syscall is prefixed with `lua:` it exposes the syscall as a native Lua function, skipping the argument conversion0
 */
export function exposeSyscalls(env: LuaEnv, system: System<any>) {
  // Expose all syscalls to Lua
  const nativeFs = new LuaStackFrame(env, null);
  for (const syscallName of system.registeredSyscalls.keys()) {
    const isLuaNativeSyscall = syscallName.startsWith("lua:");
    let cleanSyscallName = syscallName;
    if (isLuaNativeSyscall) {
      cleanSyscallName = syscallName.slice("lua:".length);
    }
    const [ns, fn] = cleanSyscallName.split(".");
    if (!env.has(ns)) {
      env.set(ns, new LuaTable(), nativeFs);
    }
    const luaFn = isLuaNativeSyscall
      ? new LuaBuiltinFunction((_sf, ...args) => {
        return system.localSyscall(syscallName, args);
      })
      : new LuaNativeJSFunction((...args) => {
        return system.localSyscall(syscallName, args);
      });
    env.get(ns, nativeFs).set(fn, luaFn, nativeFs);
  }
}

export async function buildThreadLocalEnv(
  system: System<any>,
  globalEnv: LuaEnv,
) {
  const tl = new LuaEnv();
  if (system.registeredSyscalls.has("editor.getCurrentPageMeta")) {
    const currentPageMeta = await system.localSyscall(
      "editor.getCurrentPageMeta",
      [],
    );
    if (currentPageMeta) {
      tl.setLocal("currentPage", currentPageMeta);
    } else {
      tl.setLocal("currentPage", {
        name: await system.localSyscall("editor.getCurrentPage", []),
      });
    }
  }
  tl.setLocal("_GLOBAL", globalEnv);
  return tl;
}

export async function handleLuaError(e: LuaRuntimeError, system: System<any>) {
  console.error(
    "Lua eval exception",
    e.message,
    e.sf?.astCtx,
  );
  if (e.sf?.astCtx && e.sf.astCtx.ref) {
    // We got an error and actually know where it came from, let's navigate there to help debugging
    await system.localSyscall(
      "editor.flashNotification",
      [
        `Lua error: ${e.message}`,
        "error",
      ],
    );

    const ref = resolveASTReference(e.sf.astCtx);
    if (!ref) return;

    await system.localSyscall(
      "editor.flashNotification",
      [
        `Navigating to the place in the code where this error occurred in ${ref.path}`,
        "info",
      ],
    );
    await system.localSyscall("editor.navigate", [ref]);
  }
}

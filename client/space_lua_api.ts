import { isWidgetValue, WIDGET_AS_TEXT_MESSAGE } from "./space_lua/fragment.ts";
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

  exposeSyscalls(env, system);

  return env;
}

/**
 * Exposes all registered syscalls to Lua, automatically converting Lua arguments to JS values
 * If a syscall is prefixed with `lua:` it exposes the syscall as a native Lua function, skipping the argument conversion0
 */
export function exposeSyscalls(env: LuaEnv, system: System<any>) {
  const nativeFs = new LuaStackFrame(env, null);
  for (const [syscallName, syscall] of system.registeredSyscalls) {
    const isLuaNativeSyscall = syscallName.startsWith("lua:");
    let cleanSyscallName = syscallName;
    if (isLuaNativeSyscall) {
      cleanSyscallName = syscallName.slice("lua:".length);
    }
    const [ns, fn] = cleanSyscallName.split(".");
    if (!env.has(ns)) {
      env.set(ns, new LuaTable(), nativeFs);
    }
    const {
      callback: _callback,
      requiredPermissions: _requiredPermissions,
      ...metadata
    } = syscall;
    const definition = {
      kind: "syscall" as const,
      name: cleanSyscallName,
      ...metadata,
    };
    const stringParams = ((metadata as any).parameters ?? [])
      .map((p: { type?: string }, idx: number) =>
        p.type === "string" ? idx : -1,
      )
      .filter((idx: number) => idx >= 0);
    const luaFn = isLuaNativeSyscall
      ? new LuaBuiltinFunction({
          callback: (sf, ...args) => {
            return system.syscall({ sf }, syscallName, args);
          },
          ...definition,
        })
      : new LuaNativeJSFunction({
          callback: (...args) => {
            for (const idx of stringParams) {
              if (isWidgetValue(args[idx])) {
                throw new Error(WIDGET_AS_TEXT_MESSAGE);
              }
            }
            return system.localSyscall(syscallName, args);
          },
          ...definition,
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
  console.error("Lua eval exception", e.message, e.sf?.astCtx);
  if (e.sf?.astCtx?.ref) {
    await system.localSyscall("editor.flashNotification", [
      `Lua error: ${e.message}`,
      "error",
    ]);

    const ref = resolveASTReference(e.sf.astCtx);
    if (!ref) return;

    await system.localSyscall("editor.flashNotification", [
      `Navigating to the place in the code where this error occurred in ${ref.path}`,
      "info",
    ]);
    await system.localSyscall("editor.navigate", [ref]);
  }
}

import { builtinHandle, builtinMeta } from "./builtins.ts";
import { luaHandle, RESERVED_PICK_PREFIX, type ViewSpec } from "./lua_views.ts";
import type { LuaEnv } from "../space_lua/runtime.ts";
import type { NavigatorHook, ViewMeta } from "./types.ts";

export type LuaView = {
  meta: ViewMeta;
  spec: ViewSpec;
  /** Set on a `navigator.pick` view: what a settling selection resolves. */
  onPick?: (obj: any) => void;
};

const luaViews = new Map<string, LuaView>();

// The Space Lua environment a view's own hooks run in. Supplied by
// `client_system.ts`, which owns it and rebuilds it on every script reload.
let luaEnvSource: (() => LuaEnv) | undefined;

export function setLuaEnvSource(source: () => LuaEnv): void {
  luaEnvSource = source;
}

// supersede waits for an in-flight select rather than nulling it out from under an already-clicked row
const inFlightSelects = new Map<string, Promise<any>>();

export function selectInFlight(view: string): Promise<any> | undefined {
  return inFlightSelects.get(view);
}

export function register(data: LuaView): void {
  const meta = data?.meta;
  if (!meta || typeof meta.name !== "string" || !meta.name) {
    throw new Error("navigator.register: meta.name is required");
  }
  if (builtinMeta(meta.name)) {
    throw new Error(
      `navigator.register: "${meta.name}" is a built-in navigator view and cannot be redefined`,
    );
  }
  luaViews.set(meta.name, data);
}

export function unregister(name: string): void {
  luaViews.delete(name);
}

/** Retires everything Space Lua defined, ahead of a script reload re-defining
 * it. Pending picks are left alone: their caller is still awaiting them. */
export function clearScriptViews(): void {
  for (const name of [...luaViews.keys()]) {
    if (!name.startsWith(RESERVED_PICK_PREFIX)) luaViews.delete(name);
  }
}

export function resolveMeta(name: string): ViewMeta | undefined {
  return builtinMeta(name) ?? luaViews.get(name)?.meta;
}

export async function handle(data: {
  view: string;
  hook: NavigatorHook;
  args?: any;
}): Promise<any> {
  const { view, hook, args } = data;
  const luaEnv = luaEnvSource?.();
  const builtin = builtinMeta(view);
  if (builtin) {
    return hook === "meta"
      ? builtin
      : await builtinHandle(view, hook, args ?? {});
  }
  const lua = luaViews.get(view);
  if (!lua) return undefined;
  if (hook === "meta") return lua.meta;
  const dispatched = luaHandle(lua.spec, hook, args ?? {}, luaEnv, lua.onPick);
  if (hook === "select") {
    inFlightSelects.set(view, dispatched);
    // .catch only suppresses the unhandled-rejection warning on this chain; the real error is still awaited and surfaced below
    dispatched
      .finally(() => {
        if (inFlightSelects.get(view) === dispatched)
          inFlightSelects.delete(view);
      })
      .catch(() => {});
  }
  return await dispatched;
}

export function openOnStartViews(): { name: string; dock: string }[] {
  const out: { name: string; dock: string }[] = [];
  for (const [name, view] of luaViews) {
    if (view.meta.openOnStart) out.push({ name, dock: view.meta.dock });
  }
  return out;
}

/**
 * The navigator's single view registry: built-ins (statically, from
 * `builtins.ts`) and Space Lua views (registered by `navigator.define`/
 * `navigator.pick`, via `navigator.register` below), resolved and dispatched
 * through the one bridge entry point the panel calls -- `navigator.handle`.
 */

import { events } from "@silverbulletmd/silverbullet/syscalls";
import { builtinHandle, builtinMeta } from "./builtins.ts";
import type { NavigatorHook, ViewMeta } from "../ui/types.ts";

const luaViews = new Map<string, ViewMeta>();

// A Lua-owned view's `select` round trip, while it's still crossing the
// bridge -- `navigator.ts`'s supersede (a newer activation taking the same
// slot) waits for it rather than nulling a pick out from under a row the
// user already clicked. See `selectInFlight`.
const inFlightSelects = new Map<string, Promise<any>>();

/** The `select` round trip still crossing the bridge for `view`, if any. */
export function selectInFlight(view: string): Promise<any> | undefined {
  return inFlightSelects.get(view);
}

/**
 * Upserts a Space Lua view's already-serialized meta. Called once per
 * `navigator.define`/`navigator.pick` evaluation (a full Space Lua reload
 * re-runs every `define`, so this re-registers by name). Rejects a name
 * already claimed by a built-in -- thrown synchronously, so it surfaces at
 * `navigator.define` time in the user's space rather than silently losing
 * to (or shadowing) the built-in.
 */
export function register(data: { meta: ViewMeta }): void {
  const meta = data?.meta;
  if (!meta || typeof meta.name !== "string" || !meta.name) {
    throw new Error("navigator.register: meta.name is required");
  }
  if (builtinMeta(meta.name)) {
    throw new Error(
      `navigator.register: "${meta.name}" is a built-in navigator view and cannot be redefined`,
    );
  }
  luaViews.set(meta.name, meta);
}

/**
 * Drops a Lua view's registration. Only ever called for a `navigator.pick`'s
 * `__pick:` name, once its pick has settled (`navigator.ts`'s `settlePick`)
 * -- unlike an ordinary `navigator.define`d view (upserted by name, and left
 * inert rather than swept if a space stops defining it), a pick's name is
 * used exactly once and would otherwise sit in this map for the rest of the
 * session.
 */
export function unregister(name: string): void {
  luaViews.delete(name);
}

export function resolveMeta(name: string): ViewMeta | undefined {
  return builtinMeta(name) ?? luaViews.get(name);
}

/**
 * Routes a built-in straight to its TS handler; a Lua-owned view through the
 * single `navigator:luaCall` event Navigator.md listens for. An unknown view
 * resolves nothing, same as a built-in name with no matching view.
 */
export async function handle(data: {
  view: string;
  hook: NavigatorHook;
  args?: any;
}): Promise<any> {
  const { view, hook, args } = data;
  const builtin = builtinMeta(view);
  if (builtin) {
    return hook === "meta"
      ? builtin
      : await builtinHandle(view, hook, args ?? {});
  }
  const lua = luaViews.get(view);
  if (!lua) return undefined;
  if (hook === "meta") return lua;
  const dispatched = events.dispatchEvent("navigator:luaCall", {
    view,
    hook,
    args: args ?? {},
  });
  if (hook === "select") {
    inFlightSelects.set(view, dispatched);
    // The real error (if any) is still `await`ed and surfaced below --
    // this `.catch` only keeps that same rejection from *also* being
    // reported as unhandled on this second, cleanup-only chain off it.
    dispatched
      .finally(() => {
        if (inFlightSelects.get(view) === dispatched)
          inFlightSelects.delete(view);
      })
      .catch(() => {});
  }
  const [result] = await dispatched;
  return result;
}

/**
 * Space Lua views declaring `openOnStart`, for `navigator.ts`'s boot restore
 * -- the plug answers this from its own registry instead of broadcasting for
 * it. Built-ins don't participate: `openOnStart` is a Space Lua-only field
 * (validated in Navigator.md, and nothing in `views/*.ts` sets it).
 */
export function openOnStartViews(): { name: string; dock: string }[] {
  const out: { name: string; dock: string }[] = [];
  for (const [name, meta] of luaViews) {
    if (meta.openOnStart) out.push({ name, dock: meta.dock });
  }
  return out;
}

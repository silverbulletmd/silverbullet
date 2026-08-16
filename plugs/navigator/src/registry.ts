import { events } from "@silverbulletmd/silverbullet/syscalls";
import { builtinHandle, builtinMeta } from "./builtins.ts";
import type { NavigatorHook, ViewMeta } from "../ui/types.ts";

const luaViews = new Map<string, ViewMeta>();

// supersede waits for an in-flight select rather than nulling it out from under an already-clicked row
const inFlightSelects = new Map<string, Promise<any>>();

export function selectInFlight(view: string): Promise<any> | undefined {
  return inFlightSelects.get(view);
}

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

export function unregister(name: string): void {
  luaViews.delete(name);
}

export function resolveMeta(name: string): ViewMeta | undefined {
  return builtinMeta(name) ?? luaViews.get(name);
}

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
    // .catch only suppresses the unhandled-rejection warning on this chain; the real error is still awaited and surfaced below
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

export function openOnStartViews(): { name: string; dock: string }[] {
  const out: { name: string; dock: string }[] = [];
  for (const [name, meta] of luaViews) {
    if (meta.openOnStart) out.push({ name, dock: meta.dock });
  }
  return out;
}

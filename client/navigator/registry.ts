import type { LuaEnv } from "../space_lua/runtime.ts";
import { builtinHandle, builtinMeta, builtinViewNames } from "./builtins.ts";
import { luaHandle } from "./lua_views.ts";
import { type PanelView, panelViewMeta } from "./plug_views.ts";
import type { NavigatorHook, ViewMeta } from "./types.ts";
import { RESERVED_PICK_PREFIX, type ViewSpec } from "./view_spec.ts";

export type LuaView = {
  meta: ViewMeta;
  spec: ViewSpec;
  /** Set on a `navigator.pick` view: what a settling selection resolves. */
  onPick?: (obj: any) => void;
};

const luaViews = new Map<string, LuaView>();

// Panel views plugs declare in their manifests (`plug_views.ts`). Their body
// is native (a hosted panel), so the registry only answers for their meta.
const panelViews = new Map<string, { view: PanelView; meta: ViewMeta }>();

/** Replaces every plug-declared panel view; called as plugs (un)load */
export function setPanelViews(views: PanelView[]): void {
  panelViews.clear();
  for (const view of views) {
    if (builtinMeta(view.def.name)) {
      console.warn(
        `Plug ${view.plug}: view "${view.def.name}" is a built-in navigator view and cannot be redefined`,
      );
      continue;
    }
    panelViews.set(view.def.name, { view, meta: panelViewMeta(view.def) });
  }
}

export function panelView(name: string): PanelView | undefined {
  return panelViews.get(name)?.view;
}

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
    throw new Error("view.define: meta.name is required");
  }
  if (builtinMeta(meta.name)) {
    throw new Error(
      `view.define: "${meta.name}" is a built-in navigator view and cannot be redefined`,
    );
  }
  if (panelViews.has(meta.name)) {
    throw new Error(
      `view.define: "${meta.name}" is defined by plug ${panelViews.get(meta.name)!.view.plug} and cannot be redefined`,
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

export function allViewNames(): string[] {
  return [...builtinViewNames(), ...panelViews.keys(), ...luaViews.keys()];
}

export function resolveMeta(name: string): ViewMeta | undefined {
  return (
    builtinMeta(name) ?? panelViews.get(name)?.meta ?? luaViews.get(name)?.meta
  );
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
  const panel = panelViews.get(view);
  if (panel) {
    if (hook === "meta") return panel.meta;
    // No rows and nothing to select: the hosted panel is the whole body
    return hook === "rows" ? [] : undefined;
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

/** What a content view's `content` hook resolved to: a value, or why not. */
export type ContentResult =
  | { value: unknown; error?: undefined }
  | { error: string; value?: undefined };

export function normalizeContent(result: any): ContentResult {
  if (result && typeof result.error === "string") {
    return { error: result.error };
  }
  return { value: result && "value" in result ? result.value : null };
}

export async function loadContent(
  view: string,
  ctx?: { phrase?: string; dock?: string },
): Promise<ContentResult> {
  try {
    return normalizeContent(
      await handle({
        view,
        hook: "content",
        args: { ctx: { phrase: ctx?.phrase ?? "", dock: ctx?.dock } },
      }),
    );
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

export function openOnStartViews(): { name: string; dock: string }[] {
  const out: { name: string; dock: string }[] = [];
  for (const [name, view] of luaViews) {
    if (view.meta.openOnStart) out.push({ name, dock: view.meta.dock });
  }
  return out;
}

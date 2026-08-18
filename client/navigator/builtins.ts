/**
 * The built-in navigation pickers' static half of the registry: meta,
 * dispatch, and validation. `registry.ts` layers the Space Lua half (and the
 * one `navigator.handle` entry point) on top. Each view's own definition
 * lives in `./views/*.ts`.
 */

import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { RESERVED_KEYS } from "./lua_views.ts";
import type { NavigatorHook, Row, ViewMeta } from "./types.ts";
import { anchorPicker } from "./views/anchors.ts";
import { commandPalette } from "./views/commands.ts";
import { pagePicker } from "./views/pages.ts";
import { spaceTreeView } from "./views/space_tree.ts";
import { tagPicker } from "./views/tags.ts";
import { tocModalView, tocView } from "./views/toc.ts";
import type { BuiltinView } from "./views/types.ts";

async function isReadOnly(): Promise<boolean> {
  if ((await system.getMode()) === "ro") return true;
  return (await editor.getUiOption("forcedROMode")) === true;
}

// `any`, deliberately: this registry (and the dispatch below) is generic
// over every view's own row type, which each declares independently in its
// own `./views/*.ts` -- from here, the row a given event's `obj` carries is
// opaque until the receiving view's own typed callback reads it.
const views: Record<string, BuiltinView<any>> = {
  "std.pages": pagePicker,
  "std.anchors": anchorPicker,
  "std.tags": tagPicker,
  "std.commands": commandPalette,
  "std.toc": tocView,
  "std.tocModal": tocModalView,
  "std.spaceTree": spaceTreeView,
};

// A built-in claiming one of these would silently shadow panel navigation
// (`keyboard.ts`'s `tryKeymap` runs ahead of it), with no error anywhere to
// say so. `navigator.define` rejects it per call; a built-in has no `define`
// to reject, so this runs at module load instead.
export function validateKeymaps(
  registry: Record<string, Pick<BuiltinView, "keymap">>,
): void {
  for (const [name, view] of Object.entries(registry)) {
    for (const key of Object.keys(view.keymap ?? {})) {
      if (RESERVED_KEYS.has(key)) {
        throw new Error(
          `navigator builtin "${name}": keymap key "${key}" is reserved by built-in navigation`,
        );
      }
    }
  }
}

validateKeymaps(views);

export function builtinMeta(name: string): ViewMeta | undefined {
  const view = views[name];
  if (!view) return undefined;
  return {
    ...view.meta,
    name,
    builtin: true,
    hasMove: !!view.onMove,
    keys: view.keymap ? Object.keys(view.keymap) : undefined,
    actions: view.actions?.map((action) => ({
      icon: action.icon,
      label: action.label,
      hasWhen: action.when !== undefined,
      requireMode: action.requireMode,
    })),
    segments: view.segments?.map((segment) => ({
      label: segment.label,
      icon: segment.icon,
      hasWhere: segment.where !== undefined,
      default: segment.default === true,
      prefix: segment.prefix,
      placeholder: segment.placeholder,
    })),
  } as ViewMeta;
}

async function builtinRows(name: string): Promise<Row[] | { error: string }> {
  const view = views[name];
  if (!view) return [];
  try {
    const objs = await view.source();
    return objs.map((obj) => ({
      obj,
      primary: view.row.primary?.(obj) ?? obj.name ?? obj.ref,
      label: view.row.label?.(obj),
      description: view.row.description?.(obj),
      decorations: view.row.decorations?.(obj),
      cssClass: view.row.cssClass?.(obj),
    }));
  } catch (e: any) {
    // The panel renders this rather than emptying itself, same as the Lua
    // bridge does with a throwing source.
    return { error: e?.message ?? String(e) };
  }
}

/**
 * One pass over the whole batch, exactly as the Lua bridge does it: every
 * segment predicate and every row icon, for every object the panel may draw.
 */
function builtinRowState(name: string, objs: any[]) {
  const view = views[name];
  if (!view) return [];
  // A source-mode view subsets in its own source, off the segment label it is
  // handed; its `where` predicates are never consulted. No built-in is
  // source-mode today -- this is here so the two registries answer the same
  // way if one ever is.
  const wantsSegments = view.segments && view.meta.search !== "source";
  const wantsActions = !!view.actions;
  return objs.map((obj) => {
    const entry: { segments?: boolean[]; actions?: boolean[]; icon?: string } =
      {};
    if (wantsSegments) {
      entry.segments = view.segments!.map((segment) => {
        if (!segment.where) return true;
        // Fail-closed: a throwing predicate drops the row from its segment
        // rather than taking down the pass.
        try {
          return segment.where(obj) === true;
        } catch {
          return false;
        }
      });
    }
    if (wantsActions) {
      entry.actions = view.actions!.map((action) => {
        if (!action.when) return true;
        // Same fail-closed rule as segments: a throwing predicate hides its
        // action rather than taking down the whole pass.
        try {
          return action.when(obj) === true;
        } catch {
          return false;
        }
      });
    }
    // Guarded per row, like the Lua bridge: one throwing icon costs that row
    // its icon, not the whole pass -- which the panel would read as every
    // segment being empty.
    try {
      const icon = view.row.icon?.(obj);
      if (icon) entry.icon = icon;
    } catch {}
    return entry;
  });
}

/**
 * What the Lua bridge's `runHandler` does, for the TS registry's handlers: a
 * throwing `onSelect`/`onCreate` becomes a notification rather than a
 * rejection nobody catches. The panel dispatches these fire-and-forget, so an
 * escaping error would leave the user with a panel that silently did nothing
 * (or, for the modal, one that vanished without acting).
 */
async function runHandler<T>(
  what: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e: any) {
    await editor.flashNotification(
      `navigator ${what}: ${e?.message ?? e}`,
      "error",
    );
    return undefined;
  }
}

/**
 * The whole built-in registry behind one dispatcher, keyed by the same
 * `hook` the panel sends every registry through `navigator.handle`
 * (`registry.ts`). `meta` isn't handled here -- `builtinMeta` above already
 * answers it directly, without needing a view to route through.
 */
export async function builtinHandle(
  name: string,
  hook: NavigatorHook,
  args: any,
): Promise<any> {
  switch (hook) {
    case "rows":
      return await builtinRows(name);
    case "rowState":
      return builtinRowState(name, args.objs ?? []);
    case "select": {
      const view = views[name];
      if (!view) return undefined;
      return await runHandler("onSelect", () =>
        view.onSelect(args.obj, { from: args.from }),
      );
    }
    case "create": {
      const view = views[name];
      if (!view?.onCreate) return undefined;
      return await runHandler("onCreate", () => view.onCreate!(args.phrase));
    }
    case "key": {
      const fn = views[name]?.keymap?.[args.key];
      if (!fn) return undefined;
      return await runHandler("keymap", () => fn(args.obj));
    }
    case "action": {
      // `index` is 1-based from the engine (`engine.ts`'s `action()`), same
      // as Lua's own `actions` table.
      const action = views[name]?.actions?.[args.index - 1];
      if (!action) return undefined;
      if (action.requireMode === "rw" && (await isReadOnly())) {
        await editor.flashNotification(
          `navigator: ${action.label} is unavailable in read-only mode`,
          "error",
        );
        return undefined;
      }
      return await runHandler("action", () => action.run(args.obj));
    }
    case "move": {
      const view = views[name];
      if (!view?.onMove) return undefined;
      return await runHandler("onMove", () =>
        view.onMove!(args.obj, args.newName),
      );
    }
    default:
      return undefined;
  }
}

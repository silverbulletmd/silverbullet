import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { normalizeDescription } from "../../plug-api/ui/description.ts";
import {
  type ILuaFunction,
  type LuaEnv,
  LuaStackFrame,
  luaValueToJS,
} from "../space_lua/runtime.ts";
import type { DropdownOption, NavigatorHook } from "./types.ts";

import {
  field,
  luaType,
  or,
  present,
  presentationMode,
  searchMode,
  sequence,
  tableColumns,
  toJS,
  truthy,
  type ViewSpec,
} from "./view_spec.ts";

// The frame has to carry the space's global env: string methods (`name:split(...)`) resolve their metatable off `_GLOBAL`, and a lost frame has none.
async function callLua(
  sf: LuaStackFrame,
  fn: ILuaFunction,
  ...args: any[]
): Promise<any> {
  return await luaValueToJS(fn, sf)(...args);
}

function handlerFrame(luaEnv?: LuaEnv): LuaStackFrame {
  return luaEnv
    ? LuaStackFrame.createWithGlobalEnv(luaEnv)
    : LuaStackFrame.lostFrame;
}

// The panel dispatches these fire-and-forget, so an escaping error would be invisible -- no panel feedback, nothing in the UI.
async function runHandler(what: string, fn: () => Promise<any>): Promise<any> {
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

async function readOnlyMode(): Promise<boolean> {
  if ((await system.getMode()) === "ro") return true;
  return (await editor.getUiOption("forcedROMode")) === true;
}

async function resolveDecorations(
  sf: LuaStackFrame,
  fn: unknown,
  obj: any,
): Promise<any> {
  if (fn === undefined || fn === null) return undefined;
  const out = await callLua(sf, fn as ILuaFunction, obj);
  if (out === undefined || out === null) return undefined;
  if (Array.isArray(out)) return out.length === 0 ? undefined : out;
  // An empty Lua table has no array part and arrives as an object: that is "no chips", not a shape mistake.
  if (luaType(out) === "table" && Object.keys(out as object).length === 0) {
    return undefined;
  }
  throw new Error(
    "navigator: presentation.row.decorations must return a list of chips",
  );
}

async function resolveField(
  sf: LuaStackFrame,
  fieldOrFn: unknown,
  obj: any,
): Promise<any> {
  if (fieldOrFn === undefined || fieldOrFn === null) return undefined;
  if (luaType(fieldOrFn) === "function") {
    return await callLua(sf, fieldOrFn as ILuaFunction, obj);
  }
  return obj?.[fieldOrFn as string];
}

async function buildRows(
  sf: LuaStackFrame,
  spec: ViewSpec,
  ctx: any,
): Promise<any[]> {
  const row = or(field(or(field(spec, "presentation"), {}), "row"), {});
  const objs = await callLua(sf, field(spec, "source") as ILuaFunction, ctx);
  if (objs === null || typeof objs !== "object") {
    throw new Error(
      `navigator: source must return a list, got ${luaType(objs)}`,
    );
  }
  const columns = tableColumns(spec);
  const definitions = sequence(field(field(spec, "presentation"), "columns"));
  const isTable = presentationMode(spec) === "table";
  const rows: any[] = [];
  // A Lua table with no array part converts to an object, which is what `ipairs` walks zero times.
  for (const obj of Array.isArray(objs) ? objs : []) {
    const cells = columns
      ? await Promise.all(
          columns.map((column, index) => {
            const value = field(definitions[index], "value");
            return present(value)
              ? callLua(sf, value as ILuaFunction, obj)
              : column.attribute === undefined
                ? undefined
                : obj?.[column.attribute];
          }),
        )
      : undefined;
    rows.push({
      obj,
      ...(cells ? { cells } : {}),
      primary:
        (await resolveField(sf, field(row, "primary"), obj)) ??
        obj?.name ??
        obj?.ref ??
        (isTable
          ? Object.values(obj ?? {})
              .map(String)
              .join(" ")
          : undefined),
      label: await resolveField(sf, field(row, "label"), obj),
      description: normalizeDescription(
        await resolveField(sf, field(row, "description"), obj),
      ),
      decorations: await resolveDecorations(sf, field(row, "decorations"), obj),
      cssClass: await resolveField(sf, field(row, "cssClass"), obj),
    });
  }
  return rows;
}

async function rowState(
  sf: LuaStackFrame,
  spec: ViewSpec,
  args: any,
): Promise<any[]> {
  const icon = field(
    or(field(or(field(spec, "presentation"), {}), "row"), {}),
    "icon",
  );
  const actions = sequence(field(spec, "actions"));
  const hasActions = truthy(field(spec, "actions"));
  const segments = sequence(field(spec, "segments"));
  const hasSegments =
    truthy(field(spec, "segments")) && searchMode(spec) !== "source";
  const out: any[] = [];
  for (const obj of args.objs ?? []) {
    const entry: { segments?: boolean[]; actions?: boolean[]; icon?: string } =
      {};
    if (hasActions) {
      const mask: boolean[] = [];
      for (const action of actions) {
        const when = field(action, "when");
        if (when === undefined || when === null) {
          mask.push(true);
          continue;
        }
        try {
          mask.push((await callLua(sf, when as ILuaFunction, obj)) === true);
        } catch {
          mask.push(false);
        }
      }
      entry.actions = mask;
    }
    if (hasSegments) {
      const mask: boolean[] = [];
      for (const segment of segments) {
        const where = field(segment, "where");
        if (where === undefined || where === null) {
          mask.push(true);
          continue;
        }
        try {
          mask.push((await callLua(sf, where as ILuaFunction, obj)) === true);
        } catch {
          mask.push(false);
        }
      }
      entry.segments = mask;
    }
    if (icon !== undefined && icon !== null) {
      try {
        // Unlike `row.primary`, a string here is the icon itself, not a field name to read off the object.
        const value =
          luaType(icon) === "function"
            ? await callLua(sf, icon as ILuaFunction, obj)
            : icon;
        if (typeof value === "string") entry.icon = value;
      } catch {}
    }
    out.push(entry);
  }
  return out;
}

/**
 * One batch per load, like rowState: the options are re-evaluated here (not
 * at define time, so a dynamic set stays fresh), and every row is masked
 * against every option's value, failing predicates closed.
 */
async function dropdownState(
  sf: LuaStackFrame,
  spec: ViewSpec,
  args: any,
): Promise<
  | { options: DropdownOption[]; masks: boolean[][]; default?: string }
  | undefined
> {
  const dropdown = field(spec, "dropdown");
  if (!truthy(dropdown)) return undefined;
  const listed =
    luaType(field(dropdown, "options")) === "function"
      ? await callLua(sf, field(dropdown, "options") as ILuaFunction)
      : field(dropdown, "options");
  const options: DropdownOption[] = [];
  for (const entry of sequence(listed)) {
    const label = field(entry, "label");
    const value = field(entry, "value");
    if (luaType(label) !== "string" || label === "" || !present(value)) {
      continue;
    }
    options.push({ label, value: toJS(value) });
  }
  const declared = field(dropdown, "default");
  let resolved: any;
  try {
    resolved = toJS(
      luaType(declared) === "function"
        ? await callLua(sf, declared as ILuaFunction)
        : declared,
    );
  } catch {
    resolved = undefined;
  }
  const key = field(dropdown, "key");
  const where = field(dropdown, "where") as ILuaFunction;
  const masks: boolean[][] = [];
  for (const obj of args.objs ?? []) {
    if (present(key)) {
      // Compute keys once per row, then compare options without further Lua calls.
      let value: unknown;
      try {
        value = toJS(await callLua(sf, key as ILuaFunction, obj));
      } catch {
        masks.push(options.map(() => false));
        continue;
      }
      masks.push(options.map((option) => option.value === value));
      continue;
    }
    const mask: boolean[] = [];
    for (const option of options) {
      try {
        mask.push((await callLua(sf, where, obj, option.value)) === true);
      } catch {
        mask.push(false);
      }
    }
    masks.push(mask);
  }
  return {
    options,
    masks,
    default: options.some((o) => o.value === resolved) ? resolved : undefined,
  };
}

/**
 * Run one panel hook against a Lua view's spec. `onPick` is the pick
 * bookkeeping a `view.pick` view carries: its user `onSelect` gets a
 * veto (returning `false`), and anything else settles the pick.
 */
export async function luaHandle(
  spec: ViewSpec,
  hook: NavigatorHook,
  args: any,
  luaEnv?: LuaEnv,
  onPick?: (obj: any) => void,
): Promise<any> {
  const sf = handlerFrame(luaEnv);
  switch (hook) {
    case "rows": {
      const incoming = args.ctx ?? {};
      const ctx = {
        phrase: incoming.phrase ?? "",
        segment: incoming.segment,
        dock: incoming.dock,
      };
      // Exceptions come back as data here (not flashed): unlike the other hooks, a throwing source leaves nothing else on screen to fall back to.
      try {
        return await buildRows(sf, spec, ctx);
      } catch (e: any) {
        return { error: e?.message ?? String(e) };
      }
    }
    case "content": {
      const content = field(spec, "content");
      if (!truthy(content)) return undefined;
      const incoming = args.ctx ?? {};
      // Same contract as "rows": a throwing content function comes back as
      // data, because there is nothing else left on screen to fall back to.
      try {
        const value = await callLua(sf, content as ILuaFunction, {
          phrase: incoming.phrase ?? "",
          dock: incoming.dock,
        });
        return { value: value === false || value === undefined ? null : value };
      } catch (e: any) {
        return { error: e?.message ?? String(e) };
      }
    }
    case "select":
      return await runHandler("onSelect", async () => {
        const onSelect = field(spec, "onSelect");
        if (onPick) {
          if (
            onSelect &&
            (await callLua(sf, onSelect as ILuaFunction, args.obj, {
              from: args.from,
            })) === false
          ) {
            return false;
          }
          onPick(args.obj);
          return undefined;
        }
        if (!onSelect) return undefined;
        return await callLua(sf, onSelect as ILuaFunction, args.obj, {
          from: args.from,
        });
      });
    case "create": {
      const onCreate = field(spec, "onCreate");
      if (!truthy(onCreate)) return undefined;
      await runHandler("onCreate", () =>
        callLua(sf, onCreate as ILuaFunction, args.phrase),
      );
      return undefined;
    }
    case "key": {
      const keymap = field(spec, "keymap");
      const fn = truthy(keymap) ? field(keymap, args.key) : undefined;
      if (!truthy(fn)) return undefined;
      await runHandler("keymap", () =>
        callLua(sf, fn as ILuaFunction, args.obj),
      );
      return undefined;
    }
    case "action": {
      const action = sequence(field(spec, "actions"))[args.index - 1];
      if (!action) return undefined;
      // The panel already hides these, but the click and a mode change could have crossed in flight, and this hook is reachable without the panel at all.
      if (field(action, "requireMode") === "rw" && (await readOnlyMode())) {
        await editor.flashNotification(
          `navigator: ${field(action, "label")} is unavailable in read-only mode`,
          "error",
        );
        return undefined;
      }
      await runHandler("action", () =>
        callLua(sf, field(action, "run") as ILuaFunction, args.obj),
      );
      return undefined;
    }
    case "rowState":
      return await rowState(sf, spec, args);
    case "dropdown":
      return await dropdownState(sf, spec, args);
    case "move": {
      const onMove = field(spec, "onMove");
      if (!truthy(onMove)) return undefined;
      await runHandler("onMove", () =>
        callLua(sf, onMove as ILuaFunction, args.obj, args.newName),
      );
      return undefined;
    }
    default:
      return undefined;
  }
}

const COMMAND_FIELDS = [
  "key",
  "mac",
  "menu",
  "menuMac",
  "menuWindows",
  "menuLinux",
  "hide",
];

/**
 * The command chrome `view.define` mirrors into a command definition.
 * Absent fields are left out rather than set to `undefined`: config validates
 * against its JSON schema, which rejects an `undefined` property value.
 */
export function commandDefinition(
  spec: ViewSpec,
  run: () => Promise<any>,
): Record<string, any> {
  const command: Record<string, any> = {
    name: toJS(field(spec, "command")),
    run,
  };
  for (const name of COMMAND_FIELDS) {
    const value = field(spec, name);
    if (value !== undefined && value !== null) command[name] = toJS(value);
  }
  return command;
}

import {
  defineView,
  focusPanel,
  moveByRename,
  openView,
  pickView,
} from "../../navigator/navigator.ts";
import type { SysCallMapping } from "../system.ts";

export function navigatorSyscalls(): SysCallMapping {
  const viewSyscalls: SysCallMapping = {
    "view.open": {
      callback: (_ctx, name: string, opts?: any) => {
        return openView(name, opts);
      },
      description: "Opens a navigator view by name.",
      parameters: [
        { name: "name", type: "string", description: "View name." },
        {
          name: "opts",
          type: "table",
          description:
            "Optional segment, phrase, dropdown, focus and quiet flags.",
          optional: true,
        },
      ],
      returns: [
        { type: "boolean", description: "Whether the view actually opened." },
      ],
      examples: [{ code: 'view.open("std.spaceTree")' }],
    },
    "view.focus": {
      callback: (_ctx, slot?: string) => focusPanel(slot),
      description:
        "Returns focus to an open navigator panel's input, keeping its current selection.",
      parameters: [
        {
          name: "slot",
          type: "string",
          description:
            "Which panel: modal, lhs or rhs. Defaults to any open one.",
          optional: true,
        },
      ],
      returns: [
        { type: "boolean", description: "Whether a panel was there to focus." },
      ],
      examples: [{ code: 'view.focus("rhs")' }],
    },
    "view.moveByRename": {
      callback: (_ctx, obj: any, newName: string) => {
        return moveByRename(obj, newName);
      },
      description:
        "Renames the page, document or folder an object stands for -- the default `onMove` for space-backed views.",
      parameters: [
        { name: "obj", type: "table", description: "The row's object." },
        { name: "newName", type: "string", description: "New name." },
      ],
      examples: [{ code: "onMove = view.moveByRename" }],
    },
    "lua:view.define": {
      callback: (_ctx, spec: any) => {
        return defineView(spec);
      },
      description:
        "Registers a navigator view, and optionally a command that opens it. Rejects a bad spec at definition time.",
      parameters: [
        {
          name: "spec",
          type: "table",
          description: "View definition; see the Navigator API docs.",
        },
      ],
      examples: [
        {
          code: 'view.define {\n  name = "myView",\n  source = function() return {} end,\n  onSelect = function(obj) editor.navigate(obj.ref) end,\n}',
        },
      ],
    },
    "lua:view.pick": {
      callback: (_ctx, spec: any) => {
        return pickView(spec);
      },
      description:
        "Opens a one-shot picker over the supplied source and returns the object picked (or nil).",
      parameters: [
        {
          name: "spec",
          type: "table",
          description:
            "Picker definition; a view.define spec minus its name and chrome.",
        },
      ],
      returns: [{ description: "The picked object, or nil." }],
      examples: [
        {
          code: 'local picked = view.pick { source = function() return { { name = "One" } } end }',
        },
      ],
    },
  };

  return {
    ...viewSyscalls,
    ...aliasNamespace(viewSyscalls, "view", "navigator"),
  };
}

function aliasNamespace(
  mapping: SysCallMapping,
  from: string,
  to: string,
): SysCallMapping {
  const aliased: SysCallMapping = {};
  for (const [name, definition] of Object.entries(mapping)) {
    const isLuaNative = name.startsWith("lua:");
    const cleanName = isLuaNative ? name.slice("lua:".length) : name;
    if (!cleanName.startsWith(`${from}.`)) continue;
    const aliasedName = `${to}.${cleanName.slice(from.length + 1)}`;
    aliased[isLuaNative ? `lua:${aliasedName}` : aliasedName] = definition;
  }
  return aliased;
}

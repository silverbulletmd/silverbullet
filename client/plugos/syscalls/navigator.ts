import type { SysCallMapping } from "../system.ts";
import {
  defineView,
  moveByRename,
  openView,
  pickView,
} from "../../navigator/navigator.ts";

/** The navigator's Space Lua API. Everything the panel itself needs is a
 * direct call into `client/navigator/`, not a syscall. */
export function navigatorSyscalls(): SysCallMapping {
  return {
    "navigator.open": {
      callback: (_ctx, name: string, opts?: any) => {
        return openView(name, opts);
      },
      description: "Opens a navigator view by name.",
      parameters: [
        { name: "name", type: "string", description: "View name." },
        {
          name: "opts",
          type: "table",
          description: "Optional segment, phrase and quiet flags.",
          optional: true,
        },
      ],
      returns: [
        { type: "boolean", description: "Whether the view actually opened." },
      ],
      examples: [{ code: 'navigator.open("std.spaceTree")' }],
    },
    "navigator.moveByRename": {
      callback: (_ctx, obj: any, newName: string) => {
        return moveByRename(obj, newName);
      },
      description:
        "Renames the page, document or folder an object stands for -- the default `onMove` for space-backed views.",
      parameters: [
        { name: "obj", type: "table", description: "The row's object." },
        { name: "newName", type: "string", description: "New name." },
      ],
      examples: [{ code: "onMove = navigator.moveByRename" }],
    },
    "lua:navigator.define": {
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
          code: 'navigator.define {\n  name = "myView",\n  source = function() return {} end,\n  onSelect = function(obj) editor.navigate(obj.ref) end,\n}',
        },
      ],
    },
    "lua:navigator.pick": {
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
            "Picker definition; a navigator.define spec minus its name and chrome.",
        },
      ],
      returns: [{ description: "The picked object, or nil." }],
      examples: [
        {
          code: 'local picked = navigator.pick { source = function() return { { name = "One" } } end }',
        },
      ],
    },
  };
}

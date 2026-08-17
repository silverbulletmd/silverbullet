import type { SysCallMapping } from "../system.ts";
import {
  defineView,
  moveByRename,
  openView,
  panelHidden,
  pickView,
  ready,
  resize,
  route,
} from "../../navigator/navigator.ts";
import { handle } from "../../navigator/registry.ts";
import type { LuaEnv } from "../../space_lua/runtime.ts";

export function navigatorSyscalls(luaEnv: () => LuaEnv): SysCallMapping {
  return {
    "navigator.handle": {
      callback: (_ctx, data: { view: string; hook: any; args?: any }) => {
        return handle(data, luaEnv());
      },
      description:
        "Runs one navigator view hook (meta, rows, rowState, select, create, key, action, move).",
      parameters: [
        {
          name: "data",
          type: "table",
          description: "View name, hook name and hook arguments.",
        },
      ],
      returns: [{ description: "Whatever the hook produced." }],
    },
    "navigator.ready": {
      callback: (_ctx, data: { slot: string }) => {
        return ready(data);
      },
      description:
        "Reports the activation a freshly booted navigator panel should display.",
      parameters: [{ name: "data", type: "table", description: "Panel slot." }],
      returns: [{ description: "Pending activation, if any." }],
    },
    "navigator.panelHidden": {
      callback: (
        _ctx,
        data: { slot: string; view?: string; token?: number },
      ) => {
        return panelHidden(data);
      },
      description: "Notifies the navigator that a panel slot was hidden.",
      parameters: [
        {
          name: "data",
          type: "table",
          description:
            "Panel slot, plus the view and activation token it was showing.",
        },
      ],
    },
    "navigator.resize": {
      callback: (
        _ctx,
        data: { slot: string; width: number; commit?: boolean; view?: string },
      ) => {
        return resize(data);
      },
      description:
        "Applies (and optionally persists) a docked navigator width.",
      parameters: [
        {
          name: "data",
          type: "table",
          description: "Panel slot, width, and whether to persist it.",
        },
      ],
    },
    "navigator.route": {
      callback: (
        _ctx,
        data: { slot: string; view: string; phrase?: string; from?: string },
      ) => {
        return route(data);
      },
      description:
        "Swaps the view a navigator slot shows for a sibling, in place.",
      parameters: [
        {
          name: "data",
          type: "table",
          description: "Panel slot, target view, carried phrase and origin.",
        },
      ],
    },
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

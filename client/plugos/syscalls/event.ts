import type { SysCallMapping } from "../system.ts";
import type { EventHookI } from "../eventhook.ts";
import type { EventSubscription } from "@silverbulletmd/silverbullet/type/event";
import { LuaStackFrame, luaValueToJS } from "../../space_lua/runtime.ts";
import type { Client } from "../../client.ts";
import { luaDefinitionRef } from "../../space_lua.ts";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";

export const listenerDefinition = Symbol("listenerDefinition");
export type DefinedListener = Function & { [listenerDefinition]?: Ref | null };

export function eventSyscalls(
  eventHook: EventHookI,
  client: Client,
): SysCallMapping {
  return {
    "event.dispatch": {
      callback: (_ctx, eventName: string, data: any) => {
        return eventHook.dispatchEvent(eventName, data);
      },
      description:
        "Dispatches an event and collects responses from its listeners.",
      parameters: [
        { name: "eventName", type: "string", description: "Event name." },
        { name: "data", description: "Event payload." },
      ],
      returns: [{ type: "table", description: "Listener responses." }],
      examples: [
        {
          code: 'local responses = event.dispatch("data.request", {id = 123})',
        },
      ],
    },
    "event.listEvents": {
      callback: () => {
        return eventHook.listEvents();
      },
      description: "Lists all event names that currently have listeners.",
      returns: [{ type: "table", description: "Registered event names." }],
    },
    /**
     * Define a Lua event listener
     */
    "event.listen": {
      callback: (_ctx, def: EventSubscription) => {
        const definition = luaDefinitionRef(def.run);
        const listener = async (...args: any[]) => {
          const val = await def.run(...args);
          return luaValueToJS(val, LuaStackFrame.lostFrame);
        };
        (listener as DefinedListener)[listenerDefinition] = definition;
        client.config.insert(["eventListeners", def.name], listener);
      },
      description: "Registers a Space Lua listener on the event bus.",
      parameters: [
        {
          name: "listener",
          type: "table",
          description: "Listener definition with name and run callback.",
        },
      ],
      examples: [
        {
          code: 'event.listen { name = "my-event", run = function(e) print(e.data) end }',
        },
      ],
    },
  };
}

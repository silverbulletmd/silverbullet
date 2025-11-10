import type { SysCallMapping } from "../system.ts";
import type { EventHookI } from "../eventhook.ts";
import type { EventSubscription } from "@silverbulletmd/silverbullet/type/event";
import { LuaStackFrame, luaValueToJS } from "../../space_lua/runtime.ts";
import type { Client } from "../../client.ts";

export function eventSyscalls(
  eventHook: EventHookI,
  client: Client,
): SysCallMapping {
  return {
    "event.dispatch": (_ctx, eventName: string, data: any) => {
      return eventHook.dispatchEvent(eventName, data);
    },
    "event.listEvents": () => {
      return eventHook.listEvents();
    },
    /**
     * Define a Lua event listener
     */
    "event.listen": (
      _ctx,
      def: EventSubscription,
    ) => {
      // console.log("Registering Lua event listener: ", def.name);
      client.config.insert([
        "eventListeners",
        def.name,
      ], async (...args: any[]) => {
        // Convert return value to JS
        const val = await def.run(...args);
        return luaValueToJS(val, LuaStackFrame.lostFrame);
      });
    },
  };
}

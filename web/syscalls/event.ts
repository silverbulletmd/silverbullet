// deno-lint-ignore-file ban-types
import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { LuaStackFrame, luaValueToJS } from "../../lib/space_lua/runtime.ts";
import type { Client } from "../client.ts";

import type { EventSubscription } from "../../type/event.ts";

export function eventListenerSyscalls(
  client: Client,
): SysCallMapping {
  return {
    /**
     * Define a Lua event listener
     */
    "event.listen": (
      _ctx,
      def: EventSubscription,
    ) => {
      // console.log("Registering Lua event listener: ", def.name);
      const listeners = client.config.get<Function[]>([
        "eventListeners",
        def.name,
      ], []);
      listeners.push((...args: any[]) => {
        // Convert return value to JS
        return def.run(...args).then((val) =>
          luaValueToJS(val, LuaStackFrame.lostFrame)
        );
      });
      client.config.set(["eventListeners", def.name], listeners);
    },
  };
}

import type { SysCallMapping } from "$lib/plugos/system.ts";
import type { EventListenerDef } from "../space_script.ts";
import { buildThreadLocalEnv, handleLuaError } from "../space_lua_api.ts";
import {
  type ILuaFunction,
  jsToLuaValue,
  luaCall,
  LuaStackFrame,
  luaValueToJS,
} from "../../lib/space_lua/runtime.ts";
import type { ClientSystem } from "../client_system.ts";

export type CallbackEventListener = EventListenerDef & {
  run: ILuaFunction;
};

export function eventListenerSyscalls(
  clientSystem: ClientSystem,
): SysCallMapping {
  return {
    /**
     * Define a Lua event listener
     */
    "event.listen": (
      _ctx,
      def: CallbackEventListener,
    ) => {
      console.log("Registering Lua event listener: ", def.name);
      clientSystem.scriptEnv.registerEventListener(
        def,
        async (...args: any[]) => {
          const tl = await buildThreadLocalEnv(
            clientSystem.system,
            clientSystem.spaceLuaEnv.env,
          );
          const sf = new LuaStackFrame(tl, null);
          try {
            const val = luaValueToJS(
              await luaCall(def.run, args.map(jsToLuaValue), {}, sf),
              sf,
            );
            return val;
          } catch (e: any) {
            await handleLuaError(e, clientSystem.system);
          }
        },
      );
    },
  };
}

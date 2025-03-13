import type { SysCallMapping } from "$lib/plugos/system.ts";
import type { EventListenerDef } from "$common/space_script.ts";
import { buildThreadLocalEnv, handleLuaError } from "$common/space_lua_api.ts";
import {
  type ILuaFunction,
  jsToLuaValue,
  luaCall,
  LuaStackFrame,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";
import type { CommonSystem } from "$common/common_system.ts";

export type CallbackEventListener = EventListenerDef & {
  run: ILuaFunction;
};

export function eventListenerSyscalls(
  commonSystem: CommonSystem,
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
      commonSystem.scriptEnv.registerEventListener(
        def,
        async (...args: any[]) => {
          const tl = await buildThreadLocalEnv(
            commonSystem.system,
            commonSystem.spaceLuaEnv.env,
          );
          const sf = new LuaStackFrame(tl, null);
          try {
            const val = luaValueToJS(
              await luaCall(def.run, args.map(jsToLuaValue), {}, sf),
              sf,
            );
            return val;
          } catch (e: any) {
            await handleLuaError(e, commonSystem.system);
          }
        },
      );
    },
  };
}

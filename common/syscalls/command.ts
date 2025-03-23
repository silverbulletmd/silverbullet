import type { SysCallMapping } from "$lib/plugos/system.ts";
import type { CommandDef } from "$lib/command.ts";
import { buildThreadLocalEnv, handleLuaError } from "$common/space_lua_api.ts";
import {
  type ILuaFunction,
  jsToLuaValue,
  luaCall,
  LuaStackFrame,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";
import type { ClientSystem } from "../../web/client_system.ts";

export type CallbackCommandDef = CommandDef & {
  run: ILuaFunction;
};

export function commandSyscalls(
  clientSystem: ClientSystem,
): SysCallMapping {
  return {
    /**
     * Define a Lua command
     * @param def - The command definition
     * @param luaCallback - The Lua callback
     */
    "command.define": (
      _ctx,
      def: CallbackCommandDef,
    ) => {
      console.log("Registering Lua command: ", def.name);
      clientSystem.scriptEnv.registerCommand(
        def,
        async (...args: any[]) => {
          const tl = await buildThreadLocalEnv(
            clientSystem.system,
            clientSystem.spaceLuaEnv.env,
          );
          const sf = new LuaStackFrame(tl, null);
          try {
            return luaValueToJS(
              await luaCall(def.run, args.map(jsToLuaValue), {}, sf),
              sf,
            );
          } catch (e: any) {
            await handleLuaError(e, clientSystem.system);
          }
        },
      );
    },
    "slashcommand.define": (
      _ctx,
      def: CallbackCommandDef,
    ) => {
      clientSystem.scriptEnv.registerSlashCommand(
        def,
        async (...args: any[]) => {
          const tl = await buildThreadLocalEnv(
            clientSystem.system,
            clientSystem.spaceLuaEnv.env,
          );
          const sf = new LuaStackFrame(tl, null);
          try {
            return luaValueToJS(
              await luaCall(def.run, args.map(jsToLuaValue), {}, sf),
              sf,
            );
          } catch (e: any) {
            await handleLuaError(e, clientSystem.system);
          }
        },
      );
    },
  };
}

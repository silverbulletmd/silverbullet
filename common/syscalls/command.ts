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
import type { CommonSystem } from "$common/common_system.ts";

export type CallbackCommandDef = CommandDef & {
  run: ILuaFunction;
};

export function commandSyscalls(
  commonSystem: CommonSystem,
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
      commonSystem.scriptEnv.registerCommand(
        def,
        async (...args: any[]) => {
          const tl = await buildThreadLocalEnv(
            commonSystem.system,
            commonSystem.spaceLuaEnv.env,
          );
          const sf = new LuaStackFrame(tl, null);
          try {
            return luaValueToJS(
              await luaCall(def.run, args.map(jsToLuaValue), {}, sf),
            );
          } catch (e: any) {
            await handleLuaError(e, commonSystem.system);
          }
        },
      );
    },
    "slash_command.define": (
      _ctx,
      def: CallbackCommandDef,
    ) => {
      commonSystem.scriptEnv.registerSlashCommand(
        def,
        async (...args: any[]) => {
          const tl = await buildThreadLocalEnv(
            commonSystem.system,
            commonSystem.spaceLuaEnv.env,
          );
          const sf = new LuaStackFrame(tl, null);
          try {
            return luaValueToJS(
              await luaCall(def.run, args.map(jsToLuaValue), {}, sf),
            );
          } catch (e: any) {
            await handleLuaError(e, commonSystem.system);
          }
        },
      );
    },
  };
}

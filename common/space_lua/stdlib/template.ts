import {
  type ILuaFunction,
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaTable,
} from "$common/space_lua/runtime.ts";
import { interpolateLuaString } from "$common/space_lua/stdlib/space_lua.ts";

export const templateApi = new LuaTable({
  each: new LuaBuiltinFunction(
    async (sf, tbl: LuaTable | any[], fn: ILuaFunction): Promise<string> => {
      const result = [];
      if (tbl instanceof LuaTable) {
        tbl = tbl.toJSArray();
      }
      for (const item of tbl) {
        result.push(await fn.call(sf, item));
      }
      return result.join("");
    },
  ),
  new: new LuaBuiltinFunction(
    (_sf, template: string): ILuaFunction => {
      const lines = template.split("\n").map((line) =>
        line.replace(/^\s{4}/, "")
      );
      const processed = lines.join("\n");
      return new LuaBuiltinFunction(
        async (sf, env: LuaTable | any) => {
          if (!(env instanceof LuaTable)) {
            env = jsToLuaValue(env);
          }
          return await interpolateLuaString(sf, processed, env);
        },
      );
    },
  ),
});

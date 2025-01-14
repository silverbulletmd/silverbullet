import {
  type ILuaFunction,
  LuaBuiltinFunction,
  LuaTable,
} from "$common/space_lua/runtime.ts";

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
});

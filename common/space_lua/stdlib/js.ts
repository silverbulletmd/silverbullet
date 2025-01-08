import {
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaTable,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";

export const jsApi = new LuaTable({
  new: new LuaBuiltinFunction(
    (constructorFn: any, ...args) => {
      return new constructorFn(
        ...args.map(luaValueToJS),
      );
    },
  ),
  importModule: new LuaBuiltinFunction((_sf, url) => {
    return import(url);
  }),

  tolua: new LuaBuiltinFunction((_sf, val) => jsToLuaValue(val)),
  tojs: new LuaBuiltinFunction((_sf, val) => luaValueToJS(val)),
  log: new LuaBuiltinFunction((_sf, ...args) => {
    console.log(...args);
  }),
  stringify: new LuaBuiltinFunction((_sf, val) => JSON.stringify(val)),
  // assignGlobal: new LuaBuiltinFunction((name: string, value: any) => {
  //     (globalThis as any)[name] = value;
  // }),
});

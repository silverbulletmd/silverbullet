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
  importModule: new LuaBuiltinFunction((url) => {
    return import(url);
  }),

  tolua: new LuaBuiltinFunction(jsToLuaValue),
  tojs: new LuaBuiltinFunction(luaValueToJS),
  log: new LuaBuiltinFunction((...args) => {
    console.log(...args);
  }),
  // assignGlobal: new LuaBuiltinFunction((name: string, value: any) => {
  //     (globalThis as any)[name] = value;
  // }),
});

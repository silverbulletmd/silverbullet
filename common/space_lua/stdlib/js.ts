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
  /**
   * Binds a function to an object, so that the function can be called with the object as `this`. Some JS APIs require this.
   */
  bind: new LuaBuiltinFunction((fn: any, obj: any, ...args: any[]) => {
    return fn.bind(obj, ...args);
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

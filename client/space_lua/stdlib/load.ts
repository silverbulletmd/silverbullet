import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaMultiRes,
  LuaStackFrame,
  type LuaValue,
} from "../runtime.ts";
import { parse } from "../parse.ts";
import { evalStatement } from "../eval.ts";

// Returns a function (callable chunk) or (nil, "error message") pair.
export function luaLoad(sf: LuaStackFrame, code: LuaValue): LuaValue {
  const s = typeof code === "string" ? code : String(code);

  try {
    const block = parse(s, sf.astCtx || {});
    const globalEnv: LuaEnv = sf.threadLocal.get("_GLOBAL") || new LuaEnv();

    const runner = new LuaBuiltinFunction(async (innerSf: LuaStackFrame) => {
      const res = await evalStatement(block, globalEnv, innerSf, true);
      if (res === undefined) {
        return null;
      } else {
        return new LuaMultiRes(res);
      }
    });

    return runner;
  } catch (e: any) {
    const msg = e && typeof e.message === "string" ? e.message : String(e);
    return new LuaMultiRes([null, msg]);
  }
}

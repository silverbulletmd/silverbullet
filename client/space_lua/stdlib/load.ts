import {
  LuaBuiltinFunction,
  type LuaEnv,
  LuaMultiRes,
  type LuaStackFrame,
  type LuaValue,
} from "../runtime.ts";
import { parse } from "../parse.ts";
import { evalStatement } from "../eval.ts";

// Returns a function (callable chunk) or (nil, "error message") pair.
export function luaLoad(code: LuaValue, sf: LuaStackFrame): LuaValue {
  const s = typeof code === "string" ? code : String(code);

  try {
    const block = parse(s, sf.astCtx || {});
    const globalEnvMaybe = sf.threadLocal.get("_GLOBAL");

    // Be vocal when no _GLOBAL is set
    if (!globalEnvMaybe) {
      console.warn(
        "load() called without _GLOBAL in thread-local environment",
      );
      return new LuaMultiRes([null, "Global environment not set"]);
    }

    const globalEnv: LuaEnv = globalEnvMaybe as LuaEnv;

    const runner = new LuaBuiltinFunction(async (innerSf: LuaStackFrame) => {
      const res = await evalStatement(block, globalEnv, innerSf, true);
      if (res === undefined) {
        return null;
      } else {
        if (res && typeof res === "object" && (res as any).ctrl === "return") {
          return new LuaMultiRes((res as any).values);
        }
        if (res && typeof res === "object" && (res as any).ctrl === "break") {
          throw new Error("break outside loop");
        }
        if (res && typeof res === "object" && (res as any).ctrl === "goto") {
          throw new Error("unexpected goto signal");
        }
        return null;
      }
    });

    return runner;
  } catch (e: any) {
    const msg = e && typeof e.message === "string" ? e.message : String(e);
    return new LuaMultiRes([null, msg]);
  }
}

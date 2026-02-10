import {
  LuaBuiltinFunction,
  LuaMultiRes,
  LuaRuntimeError,
  LuaTable,
} from "../runtime.ts";
import { isNegativeZero, isTaggedFloat } from "../numeric.ts";

// Fast unwrap: avoids function call overhead for the common plain-number case
function untagNumber(x: any): number {
  if (typeof x === "number") return x;
  if (isTaggedFloat(x)) return x.value;
  return Number(x);
}

export const mathApi = new LuaTable({
  // math constants
  huge: 1 / 0,
  pi: 3.1415926535898,

  // math.type(x) => "integer" | "float" | nil
  type: new LuaBuiltinFunction((_sf, x?: any) => {
    if (x === undefined) {
      throw new LuaRuntimeError(
        "bad argument #1 to 'math.type' (value expected)",
        _sf,
      );
    }
    if (isTaggedFloat(x)) {
      return "float";
    }
    if (typeof x === "number") {
      if (!Number.isFinite(x) || isNegativeZero(x)) {
        return "float";
      }
      return Number.isInteger(x) ? "integer" : "float";
    }
    if (typeof x === "bigint") {
      return "integer";
    }
    return null;
  }),
  /**
   * When called without arguments, returns a pseudo-random float with
   * uniform distribution in the range [0,1). When called with two
   * integers m and n, math.random returns a pseudo-random integer
   * with uniform distribution in the range [m, n]. The call
   * math.random(n), for a positive n, is equivalent to
   * math.random(1,n). The call math.random(0) produces an integer
   * with all bits (pseudo)random.
   */
  random: new LuaBuiltinFunction((_sf, m?: number, n?: number) => {
    if (m !== undefined) m = untagNumber(m);
    if (n !== undefined) n = untagNumber(n);

    if (m === undefined && n === undefined) {
      return Math.random();
    }

    if (!Number.isInteger(m)) {
      throw new LuaRuntimeError(
        "bad argument #1 to 'math.random' (integer expected)",
        _sf,
      );
    }

    if (n === undefined) {
      if (m! == 0) {
        const high = Math.floor(Math.random() * 0x100000000);
        const low = Math.floor(Math.random() * 0x100000000);
        let result = (BigInt(high) << 32n) | BigInt(low);
        if (result & (1n << 63n)) {
          result -= 1n << 64n;
        }
        return result;
      }
      if (m! < 1) {
        throw new LuaRuntimeError(
          "bad argument #1 to 'math.random' (interval is empty)",
          _sf,
        );
      }
      return Math.floor(Math.random() * m!) + 1;
    }

    if (!Number.isInteger(n!)) {
      throw new LuaRuntimeError(
        "bad argument #2 to 'math.random' (integer expected)",
        _sf,
      );
    }

    if (n! < m!) {
      throw new LuaRuntimeError(
        "bad argument #1 to 'math.random' (interval is empty)",
        _sf,
      );
    }
    return Math.floor(Math.random() * (n! - m! + 1)) + m!;
  }),

  // Basic functions
  abs: new LuaBuiltinFunction((_sf, x: number) => Math.abs(untagNumber(x))),
  ceil: new LuaBuiltinFunction((_sf, x: number) => Math.ceil(untagNumber(x))),
  floor: new LuaBuiltinFunction((_sf, x: number) => Math.floor(untagNumber(x))),
  max: new LuaBuiltinFunction((_sf, ...args: number[]) =>
    Math.max(...args.map(untagNumber))
  ),
  min: new LuaBuiltinFunction((_sf, ...args: number[]) =>
    Math.min(...args.map(untagNumber))
  ),

  // Rounding and remainder
  fmod: new LuaBuiltinFunction((_sf, x: number, y: number) =>
    untagNumber(x) % untagNumber(y)
  ),
  modf: new LuaBuiltinFunction((_sf, x: number) => {
    const xn = untagNumber(x);
    const int = Math.trunc(xn);
    const frac = xn - int;
    return new LuaMultiRes([int, frac]);
  }),

  // Power and logarithms
  exp: new LuaBuiltinFunction((_sf, x: number) => Math.exp(untagNumber(x))),
  log: new LuaBuiltinFunction((_sf, x: number, base?: number) => {
    if (base === undefined) {
      return Math.log(untagNumber(x));
    }
    return Math.log(untagNumber(x)) / Math.log(untagNumber(base));
  }),
  pow: new LuaBuiltinFunction((_sf, x: number, y: number) =>
    Math.pow(untagNumber(x), untagNumber(y))
  ),
  sqrt: new LuaBuiltinFunction((_sf, x: number) => Math.sqrt(untagNumber(x))),

  // Trigonometric functions
  cos: new LuaBuiltinFunction((_sf, x: number) => Math.cos(untagNumber(x))),
  sin: new LuaBuiltinFunction((_sf, x: number) => Math.sin(untagNumber(x))),
  tan: new LuaBuiltinFunction((_sf, x: number) => Math.tan(untagNumber(x))),
  acos: new LuaBuiltinFunction((_sf, x: number) => Math.acos(untagNumber(x))),
  asin: new LuaBuiltinFunction((_sf, x: number) => Math.asin(untagNumber(x))),
  atan: new LuaBuiltinFunction((_sf, y: number, x?: number) => {
    if (x === undefined) {
      return Math.atan(untagNumber(y));
    }
    return Math.atan2(untagNumber(y), untagNumber(x));
  }),

  // Hyperbolic functions
  cosh: new LuaBuiltinFunction((_sf, x: number) => Math.cosh(untagNumber(x))),
  sinh: new LuaBuiltinFunction((_sf, x: number) => Math.sinh(untagNumber(x))),
  tanh: new LuaBuiltinFunction((_sf, x: number) => Math.tanh(untagNumber(x))),

  // Additional utility
  deg: new LuaBuiltinFunction((_sf, x: number) =>
    untagNumber(x) * 180 / Math.PI
  ),
  rad: new LuaBuiltinFunction((_sf, x: number) =>
    untagNumber(x) * Math.PI / 180
  ),
  ult: new LuaBuiltinFunction((_sf, m: number, n: number) => {
    return (untagNumber(m) >>> 0) < (untagNumber(n) >>> 0);
  }),

  // Keep the cosineSimilarity utility function
  cosineSimilarity: new LuaBuiltinFunction(
    (sf, vecA: LuaTable | number[], vecB: LuaTable | number[]) => {
      if (vecA instanceof LuaTable) {
        vecA = vecA.toJSArray();
      }
      if (vecB instanceof LuaTable) {
        vecB = vecB.toJSArray();
      }

      if (vecA.length !== vecB.length) {
        throw new LuaRuntimeError("Vectors must be of the same length", sf);
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] ** 2;
        normB += vecB[i] ** 2;
      }

      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    },
  ),
});

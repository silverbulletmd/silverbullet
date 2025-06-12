import { LuaBuiltinFunction, LuaRuntimeError, LuaTable } from "../runtime.ts";

export const mathApi = new LuaTable({
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
    if (m === undefined && n === undefined) {
      // random() returns [0,1)
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
        // random(0) returns a random integer
        const high = Math.floor(Math.random() * 0x100000000);
        const low = Math.floor(Math.random() * 0x100000000);

        let result = (BigInt(high) << 32n) | BigInt(low);

        if (result & (1n << 63n)) {
          result -= 1n << 64n;
        }

        return result;
      } else {
        // random(m) returns [1,m]
        if (m! < 1) {
          throw new LuaRuntimeError(
            "bad argument #1 to 'math.random' (interval is empty)",
            _sf,
          );
        }
        return Math.floor(Math.random() * m!) + 1;
      }
    }

    if (!Number.isInteger(n!)) {
      throw new LuaRuntimeError(
        "bad argument #2 to 'math.random' (integer expected)",
        _sf,
      );
    }

    // random(m,n) returns [m,n]
    if (n! < m!) {
      throw new LuaRuntimeError(
        "bad argument #1 to 'math.random' (interval is empty)",
        _sf,
      );
    }
    return Math.floor(Math.random() * (n! - m! + 1)) + m!;
  }),

  // Basic functions
  abs: new LuaBuiltinFunction((_sf, x: number) => Math.abs(x)),
  ceil: new LuaBuiltinFunction((_sf, x: number) => Math.ceil(x)),
  floor: new LuaBuiltinFunction((_sf, x: number) => Math.floor(x)),
  max: new LuaBuiltinFunction((_sf, ...args: number[]) => Math.max(...args)),
  min: new LuaBuiltinFunction((_sf, ...args: number[]) => Math.min(...args)),

  // Rounding and remainder
  fmod: new LuaBuiltinFunction((_sf, x: number, y: number) => x % y),
  modf: new LuaBuiltinFunction((_sf, x: number) => {
    const int = Math.floor(x);
    const frac = x - int;
    return new LuaTable([int, frac]);
  }),

  // Power and logarithms
  exp: new LuaBuiltinFunction((_sf, x: number) => Math.exp(x)),
  log: new LuaBuiltinFunction((_sf, x: number, base?: number) => {
    if (base === undefined) {
      return Math.log(x);
    }
    return Math.log(x) / Math.log(base);
  }),
  pow: new LuaBuiltinFunction((_sf, x: number, y: number) => Math.pow(x, y)),
  sqrt: new LuaBuiltinFunction((_sf, x: number) => Math.sqrt(x)),

  // Trigonometric functions
  cos: new LuaBuiltinFunction((_sf, x: number) => Math.cos(x)),
  sin: new LuaBuiltinFunction((_sf, x: number) => Math.sin(x)),
  tan: new LuaBuiltinFunction((_sf, x: number) => Math.tan(x)),
  acos: new LuaBuiltinFunction((_sf, x: number) => Math.acos(x)),
  asin: new LuaBuiltinFunction((_sf, x: number) => Math.asin(x)),
  atan: new LuaBuiltinFunction((_sf, y: number, x?: number) => {
    if (x === undefined) {
      return Math.atan(y);
    }
    return Math.atan2(y, x);
  }),

  // Hyperbolic functions
  cosh: new LuaBuiltinFunction((_sf, x: number) => Math.cosh(x)),
  sinh: new LuaBuiltinFunction((_sf, x: number) => Math.sinh(x)),
  tanh: new LuaBuiltinFunction((_sf, x: number) => Math.tanh(x)),

  // Additional utility
  deg: new LuaBuiltinFunction((_sf, x: number) => x * 180 / Math.PI),
  rad: new LuaBuiltinFunction((_sf, x: number) => x * Math.PI / 180),
  ult: new LuaBuiltinFunction((_sf, m: number, n: number) => {
    // Unsigned less than comparison
    return (m >>> 0) < (n >>> 0);
  }),

  // Keep the cosineSimilarity utility function
  cosineSimilarity: new LuaBuiltinFunction(
    (sf, vecA: LuaTable | number[], vecB: LuaTable | number[]) => {
      // Convert LuaTable to number[]
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

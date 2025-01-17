import {
  LuaBuiltinFunction,
  LuaRuntimeError,
  LuaTable,
} from "$common/space_lua/runtime.ts";

export const mathApi = new LuaTable({
  // Random number generation
  random: new LuaBuiltinFunction((_sf, m?: number, n?: number) => {
    if (m === undefined && n === undefined) {
      // random() returns [0,1)
      return Math.random();
    } else if (n === undefined) {
      // random(m) returns [1,m]
      return Math.floor(Math.random() * m!) + 1;
    } else {
      // random(m,n) returns [m,n]
      return Math.floor(Math.random() * (n - m! + 1)) + m!;
    }
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

  // Keep the cosine_similarity utility function
  cosine_similarity: new LuaBuiltinFunction(
    (sf, vecA: number[], vecB: number[]) => {
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

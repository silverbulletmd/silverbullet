import {
  LuaBuiltinFunction,
  LuaMultiRes,
  LuaRuntimeError,
  LuaTable,
} from "../runtime.ts";
import { isNegativeZero, isTaggedFloat, makeLuaFloat } from "../numeric.ts";
import { LuaPRNG } from "./prng.ts";

// One PRNG per module load, auto-seeded at startup
const prng = new LuaPRNG();

// Fast unwrap: avoids function call overhead for the common plain-number case
function untagNumber(x: any): number {
  if (typeof x === "number") return x;
  if (isTaggedFloat(x)) return x.value;
  return Number(x);
}

export const mathApi = new LuaTable({
  // math constants
  huge: 1 / 0,
  pi: Math.PI,

  // math.type(x) => "integer" | "float" | nil
  type: new LuaBuiltinFunction({
    callback: (_sf, x?: any) => {
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
    },
    documentation: {
      description:
        "Returns `integer` or `float` for a number, or `nil` for other values.",
      parameters: [{ name: "x", description: "Value to inspect." }],
      returns: [
        { type: "string|nil", description: "Numeric subtype or `nil`." },
      ],
    },
  }),

  /**
   * If the value x is representable as a Lua integer, returns an integer
   * with that value. Otherwise returns nil.
   * Strings are NOT accepted — only Lua number values.
   */
  tointeger: new LuaBuiltinFunction({
    callback: (_sf, x?: any) => {
      if (typeof x === "number") {
        return Number.isInteger(x) && Number.isFinite(x) ? x : null;
      }
      if (isTaggedFloat(x)) {
        const n = x.value;
        return Number.isInteger(n) && Number.isFinite(n) ? n : null;
      }
      if (typeof x === "string") {
        const n = untagNumber(x); // Number(x) coerces the string
        if (Number.isNaN(n) || !Number.isFinite(n) || !Number.isInteger(n))
          return null;
        return n;
      }
      return null;
    },
    documentation: {
      description:
        "Converts a value to an integer when it has an exact finite integral representation.",
      parameters: [{ name: "x", description: "Value to convert." }],
      returns: [
        { type: "integer|nil", description: "Converted integer or `nil`." },
      ],
    },
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
  random: new LuaBuiltinFunction({
    callback: (_sf, m?: number, n?: number) => {
      if (m !== undefined) m = untagNumber(m);
      if (n !== undefined) n = untagNumber(n);
      try {
        return prng.random(m, n);
      } catch (e: any) {
        throw new LuaRuntimeError(e.message, _sf);
      }
    },
    documentation: {
      description:
        "Returns a pseudo-random float or an integer in a requested inclusive range.",
      signatures: [
        "math.random(): number",
        "math.random(n): integer",
        "math.random(m, n): integer",
      ],
      parameters: [
        { name: "m", type: "integer", optional: true },
        { name: "n", type: "integer", optional: true },
      ],
      returns: [{ type: "number", description: "Pseudo-random result." }],
      examples: [
        {
          code: "print(math.random())\nprint(math.random(10))\nprint(math.random(5, 10))",
        },
      ],
    },
  }),
  /**
   * Seeds the pseudo-random generator. With no arguments, uses a
   * time-based seed. Returns the two seed integers used (Lua 5.4 contract).
   */
  randomseed: new LuaBuiltinFunction({
    callback: (_sf, x?: number, y?: number) => {
      if (x !== undefined) x = untagNumber(x);
      if (y !== undefined) y = untagNumber(y);
      const [s1, s2] = prng.randomseed(x, y);
      return new LuaMultiRes([s1, s2]);
    },
    documentation: {
      description:
        "Seeds the pseudo-random generator and returns the two seeds used.",
      signatures: [
        "math.randomseed(): integer, integer",
        "math.randomseed(x, y): integer, integer",
      ],
      parameters: [
        { name: "x", type: "integer", optional: true },
        { name: "y", type: "integer", optional: true },
      ],
      returns: [
        { type: "integer", description: "First seed." },
        { type: "integer", description: "Second seed." },
      ],
    },
  }),

  // Basic functions
  abs: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.abs(untagNumber(x)),
    documentation: {
      description: "Returns the absolute value of `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  ceil: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.ceil(untagNumber(x)),
    documentation: {
      description: "Returns the smallest integer greater than or equal to `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "integer" }],
    },
  }),
  floor: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.floor(untagNumber(x)),
    documentation: {
      description: "Returns the largest integer less than or equal to `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "integer" }],
    },
  }),
  max: new LuaBuiltinFunction({
    callback: (_sf, ...args: number[]) => Math.max(...args.map(untagNumber)),
    documentation: {
      description: "Returns the greatest of its arguments.",
      signatures: ["math.max(x, ...): number"],
      returns: [{ type: "number" }],
    },
  }),
  min: new LuaBuiltinFunction({
    callback: (_sf, ...args: number[]) => Math.min(...args.map(untagNumber)),
    documentation: {
      description: "Returns the least of its arguments.",
      signatures: ["math.min(x, ...): number"],
      returns: [{ type: "number" }],
    },
  }),

  // Rounding and remainder
  fmod: new LuaBuiltinFunction({
    callback: (_sf, x: number, y: number) => untagNumber(x) % untagNumber(y),
    documentation: {
      description:
        "Returns the remainder of `x / y` with the quotient rounded toward zero.",
      parameters: [
        { name: "x", type: "number" },
        { name: "y", type: "number" },
      ],
      returns: [{ type: "number" }],
    },
  }),
  modf: new LuaBuiltinFunction({
    callback: (_sf, x: number) => {
      const xn = untagNumber(x);
      const int = Math.trunc(xn);
      // Guarantee that the `frac` part is always Lua float
      const frac = makeLuaFloat(xn - int);
      return new LuaMultiRes([int, frac]);
    },
    documentation: {
      description: "Splits `x` into its integral and fractional parts.",
      parameters: [{ name: "x", type: "number" }],
      returns: [
        { type: "integer", description: "Integral part." },
        { type: "float", description: "Fractional part." },
      ],
      examples: [{ code: "local integer, fraction = math.modf(3.14)" }],
    },
  }),

  // Returns m and e such that x = m * 2^e, 0.5 <= |m| < 1 (or m=0 when x=0).
  // e is an integer. Mirrors C99/Lua.
  // Special cases: frexp(0) = (0, 0); frexp(+-inf/nan) = (x, 0).
  frexp: new LuaBuiltinFunction({
    callback: (_sf, x: number) => {
      const xn = untagNumber(x);
      if (xn === 0 || !Number.isFinite(xn) || Number.isNaN(xn)) {
        return new LuaMultiRes([xn, 0]);
      }
      const abs = Math.abs(xn);
      let e = Math.floor(Math.log2(abs)) + 1;
      let m = xn / 2 ** e;
      if (Math.abs(m) >= 1.0) {
        e += 1;
        m /= 2;
      }
      if (Math.abs(m) < 0.5) {
        e -= 1;
        m *= 2;
      }
      return new LuaMultiRes([m, e]);
    },
    documentation: {
      description:
        "Decomposes `x` into a normalized fraction and a power-of-two exponent.",
      parameters: [{ name: "x", type: "number" }],
      returns: [
        { type: "number", description: "Fraction." },
        { type: "integer", description: "Exponent." },
      ],
    },
  }),

  // Returns m * 2^e (the inverse of frexp).  Mirrors C99/Lua.
  ldexp: new LuaBuiltinFunction({
    callback: (_sf, m: number, e: number) =>
      untagNumber(m) * 2 ** untagNumber(e),
    documentation: {
      description: "Returns `m * 2^e`, the inverse of `math.frexp`.",
      parameters: [
        { name: "m", type: "number" },
        { name: "e", type: "integer" },
      ],
      returns: [{ type: "number" }],
    },
  }),

  // Power and logarithms
  exp: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.exp(untagNumber(x)),
    documentation: {
      description: "Returns `e` raised to `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  log: new LuaBuiltinFunction({
    callback: (_sf, x: number, base?: number) => {
      if (base === undefined) {
        return Math.log(untagNumber(x));
      }
      return Math.log(untagNumber(x)) / Math.log(untagNumber(base));
    },
    documentation: {
      description:
        "Returns the logarithm of `x`, using the natural base unless another base is supplied.",
      parameters: [
        { name: "x", type: "number" },
        { name: "base", type: "number", optional: true },
      ],
      returns: [{ type: "number" }],
      examples: [{ code: "print(math.log(100, 10)) -- 2" }],
    },
  }),
  // Power function (deprecated in Lua 5.4 but retained for compatibility)
  pow: new LuaBuiltinFunction({
    callback: (_sf, x: number, y: number) => untagNumber(x) ** untagNumber(y),
    documentation: {
      description: "Returns `x` raised to the power `y`.",
      parameters: [
        { name: "x", type: "number" },
        { name: "y", type: "number" },
      ],
      returns: [{ type: "number" }],
      deprecated: "Use the `^` operator instead.",
    },
  }),
  sqrt: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.sqrt(untagNumber(x)),
    documentation: {
      description: "Returns the square root of `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),

  // Trigonometric functions
  cos: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.cos(untagNumber(x)),
    documentation: {
      description: "Returns the cosine of `x` radians.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  sin: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.sin(untagNumber(x)),
    documentation: {
      description: "Returns the sine of `x` radians.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  tan: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.tan(untagNumber(x)),
    documentation: {
      description: "Returns the tangent of `x` radians.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  acos: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.acos(untagNumber(x)),
    documentation: {
      description: "Returns the arc cosine of `x` in radians.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  asin: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.asin(untagNumber(x)),
    documentation: {
      description: "Returns the arc sine of `x` in radians.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  atan: new LuaBuiltinFunction({
    callback: (_sf, y: number, x?: number) => {
      if (x === undefined) {
        return Math.atan(untagNumber(y));
      }
      return Math.atan2(untagNumber(y), untagNumber(x));
    },
    documentation: {
      description:
        "Returns the arc tangent of `y/x` in radians, using `1` for omitted `x`.",
      parameters: [
        { name: "y", type: "number" },
        { name: "x", type: "number", optional: true },
      ],
      returns: [{ type: "number" }],
    },
  }),

  // Hyperbolic functions (deprecated in Lua 5.4 but retained for compatibility)
  cosh: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.cosh(untagNumber(x)),
    documentation: {
      description: "Returns the hyperbolic cosine of `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
      deprecated: "Retained for compatibility with older Lua versions.",
    },
  }),
  sinh: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.sinh(untagNumber(x)),
    documentation: {
      description: "Returns the hyperbolic sine of `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
      deprecated: "Retained for compatibility with older Lua versions.",
    },
  }),
  tanh: new LuaBuiltinFunction({
    callback: (_sf, x: number) => Math.tanh(untagNumber(x)),
    documentation: {
      description: "Returns the hyperbolic tangent of `x`.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
      deprecated: "Retained for compatibility with older Lua versions.",
    },
  }),

  // Additional utility
  deg: new LuaBuiltinFunction({
    callback: (_sf, x: number) => (untagNumber(x) * 180) / Math.PI,
    documentation: {
      description: "Converts an angle from radians to degrees.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
      examples: [{ code: "print(math.deg(math.pi)) -- 180" }],
    },
  }),
  rad: new LuaBuiltinFunction({
    callback: (_sf, x: number) => (untagNumber(x) * Math.PI) / 180,
    documentation: {
      description: "Converts an angle from degrees to radians.",
      parameters: [{ name: "x", type: "number" }],
      returns: [{ type: "number" }],
    },
  }),
  ult: new LuaBuiltinFunction({
    callback: (_sf, m: number, n: number) => {
      return untagNumber(m) >>> 0 < untagNumber(n) >>> 0;
    },
    documentation: {
      description: "Compares two integers as unsigned 32-bit values.",
      parameters: [
        { name: "m", type: "integer" },
        { name: "n", type: "integer" },
      ],
      returns: [{ type: "boolean" }],
      examples: [{ code: "print(math.ult(2, 3)) -- true" }],
    },
  }),

  // Keep the cosineSimilarity utility function
  cosineSimilarity: new LuaBuiltinFunction({
    callback: (sf, vecA: LuaTable | number[], vecB: LuaTable | number[]) => {
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
    documentation: {
      description:
        "Returns the cosine similarity between two equal-length numeric vectors.",
      parameters: [
        { name: "vecA", type: "table" },
        { name: "vecB", type: "table" },
      ],
      returns: [{ type: "number", description: "Cosine similarity." }],
      examples: [
        { code: "print(math.cosineSimilarity({1, 2, 3}, {4, 5, 6}))" },
      ],
    },
  }),
});

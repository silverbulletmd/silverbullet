import type { NumericType } from "./ast.ts";
import { luaToNumberDetailed } from "./tonumber.ts";
import { luaTypeName } from "./runtime.ts";

const FloatKind: unique symbol = Symbol("FloatKind");

// Marker error used to let the evaluator decide the final message.
export const luaStringCoercionError: Error = new Error(
  "LuaStringCoercionError",
);

export function isNegativeZero(x: number): boolean {
  return x === 0 && 1 / x === -Infinity;
}

function makeFloat(n: number): any {
  const box = new Number(n);
  (box as any)[FloatKind] = "float";
  return box;
}

export function floatLiteral(n: number): any {
  if (n === 0) {
    if (isNegativeZero(n)) {
      return -0;
    }
    return makeFloat(0);
  }
  if (Number.isInteger(n)) {
    return makeFloat(n);
  }
  return n;
}

export function boxZero(kind: NumericType): any {
  if (kind === "float") {
    return makeFloat(0);
  }
  return 0;
}

export function isFloatTag(v: any): boolean {
  return v instanceof Number && (v as any)[FloatKind] === "float";
}

export function getZeroBoxKind(x: any): NumericType | undefined {
  if (x instanceof Number) {
    return (x as any)[FloatKind] as NumericType | undefined;
  }
  return undefined;
}

export function untagNumber(n: any): number {
  if (n instanceof Number) {
    return Number(n);
  }
  return n;
}

export function getNumericKind(
  n: unknown,
): NumericType | undefined {
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return "float";
    if (isNegativeZero(n)) return "float";
    return Number.isInteger(n) ? "int" : "float";
  }
  if (n instanceof Number) {
    if ((n as any)[FloatKind] === "float") return "float";
    const nv = Number(n);
    if (!Number.isFinite(nv)) return "float";
    if (isNegativeZero(nv)) return "float";
    return Number.isInteger(nv) ? "int" : "float";
  }
  return undefined;
}

export type OpHints = {
  leftKind?: NumericType;
  rightKind?: NumericType;
};

export type CoerceNumericResult = {
  n: number;
  isInt: boolean;
  zeroKind?: NumericType;
};

function produceNegativeZero(): CoerceNumericResult {
  return { n: -0, isInt: false, zeroKind: "float" };
}

// Coerce a single value to a number, preserving int/float kind info.
export function coerceNumeric(val: unknown): CoerceNumericResult {
  if (typeof val === "number") {
    if (val === 0) {
      if (isNegativeZero(val)) return produceNegativeZero();
      return { n: 0, isInt: true };
    }
    return { n: val, isInt: Number.isInteger(val) };
  }

  if (val instanceof Number) {
    const n = Number(val);
    if (n === 0) {
      if (isNegativeZero(n)) return produceNegativeZero();
      const kind: NumericType = (val as any)[FloatKind] === "float"
        ? "float"
        : "int";
      return { n: 0, isInt: kind === "int", zeroKind: kind };
    }
    if ((val as any)[FloatKind] === "float") {
      return { n, isInt: false, zeroKind: "float" };
    }
    return { n, isInt: Number.isInteger(n) };
  }

  if (typeof val === "string") {
    const det = luaToNumberDetailed(val);
    if (!det) {
      throw luaStringCoercionError;
    }
    const n = det.value;
    const isInt = det.numericType === "int";
    if (n === 0) {
      if (isNegativeZero(n)) return produceNegativeZero();
      return { n: 0, isInt, zeroKind: det.numericType };
    }
    return { n, isInt };
  }

  throw new Error(
    `attempt to perform arithmetic on a ${luaTypeName(val)} value`,
  );
}

export type CoerceNumericPairResult = {
  ax: number;
  bx: number;
  bothInt: boolean;
  bZeroKind?: NumericType;
};

// Coerce a pair of values to numbers and determine the result mode.
export function coerceNumericPair(
  a: unknown,
  b: unknown,
  hints?: OpHints,
): CoerceNumericPairResult {
  // Fast path: both plain numbers (covers most int+int cases)
  if (typeof a === "number" && typeof b === "number") {
    const aIsInt = hints?.leftKind !== undefined
      ? hints.leftKind === "int"
      : (Number.isInteger(a) && !isNegativeZero(a));
    const bIsInt = hints?.rightKind !== undefined
      ? hints.rightKind === "int"
      : (Number.isInteger(b) && !isNegativeZero(b));
    return { ax: a, bx: b, bothInt: aIsInt && bIsInt };
  }

  const A = coerceNumeric(a);
  const B = coerceNumeric(b);

  const aIsInt = hints?.leftKind !== undefined
    ? hints.leftKind === "int"
    : (A.zeroKind === "float"
      ? false
      : (A.zeroKind === "int" ? true : A.isInt));

  const bIsInt = hints?.rightKind !== undefined
    ? hints.rightKind === "int"
    : (B.zeroKind === "float"
      ? false
      : (B.zeroKind === "int" ? true : B.isInt));

  return {
    ax: A.n,
    bx: B.n,
    bothInt: aIsInt && bIsInt,
    bZeroKind: B.zeroKind,
  };
}

export function toInteger(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) ? v : null;
  }
  if (v instanceof Number) {
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

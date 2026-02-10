import type { NumericType } from "./ast.ts";
import { luaToNumberDetailed } from "./tonumber.ts";
import { luaTypeName } from "./runtime.ts";

const FloatKind: unique symbol = Symbol("FloatKind");

export const luaStringCoercionError: Error = new Error(
  "LuaStringCoercionError",
);

export function isNegativeZero(n: number): boolean {
  return n === 0 && 1 / n === -Infinity;
}

function makeFloat(n: number): any {
  const box = new Number(n);
  (box as any)[FloatKind] = "float";
  return box;
}

export function makeLuaZero(
  n: number,
  numericType: NumericType,
): any {
  if (n !== 0) {
    return n;
  }
  if (numericType !== "float") {
    return 0;
  }
  return makeFloat(isNegativeZero(n) ? -0 : 0);
}

export function makeLuaFloat(n: number): any {
  if (!Number.isInteger(n)) {
    return n;
  }
  return makeFloat(n);
}

export function isLuaFloat(v: unknown): boolean {
  return v instanceof Number && (v as any)[FloatKind] === "float";
}

export const isFloatTag = isLuaFloat;

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

export function coerceToNumber(v: unknown): number | null {
  if (typeof v === "number") {
    return v;
  }
  if (v instanceof Number) {
    return Number(v);
  }
  if (typeof v === "string") {
    const det = luaToNumberDetailed(v);
    if (!det) {
      return null;
    }
    return det.value;
  }
  return null;
}

export function inferNumericType(n: number): NumericType {
  if (!Number.isFinite(n)) {
    return "float";
  }
  if (isNegativeZero(n)) {
    return "float";
  }
  return Number.isInteger(n) ? "int" : "float";
}

export function combineNumericTypes(
  a: NumericType | undefined,
  b: NumericType | undefined,
): NumericType {
  if (a === "float" || b === "float") {
    return "float";
  }
  return "int";
}

export function getNumericKind(
  n: unknown,
): NumericType | undefined {
  if (typeof n === "number") {
    return inferNumericType(n);
  }
  if (n instanceof Number) {
    if ((n as any)[FloatKind] === "float") return "float";
    const nv = Number(n);
    return inferNumericType(nv);
  }
  return undefined;
}

export type CoerceNumericResult = {
  n: number;
  type: NumericType;
};

export function coerceNumeric(
  val: unknown,
  hint?: NumericType,
): CoerceNumericResult {
  if (typeof val === "number") {
    return { n: val, type: hint ?? inferNumericType(val) };
  }

  if (val instanceof Number) {
    const n = Number(val);
    const kind = (val as any)[FloatKind] === "float" ? "float" : undefined;
    return { n, type: hint ?? kind ?? inferNumericType(n) };
  }

  if (typeof val === "string") {
    const det = luaToNumberDetailed(val);
    if (!det) {
      throw luaStringCoercionError;
    }
    return { n: det.value, type: hint ?? det.numericType };
  }

  throw new Error(
    `attempt to perform arithmetic on a ${luaTypeName(val)} value`,
  );
}

export type CoerceNumericPairResult = {
  left: number;
  right: number;
  resultType: NumericType;
};

export function coerceNumericPair(
  a: unknown,
  b: unknown,
  leftType?: NumericType,
  rightType?: NumericType,
  op?: string,
): CoerceNumericPairResult {
  const forceFloat = op === "/" || op === "^";

  // Both plain numbers
  if (typeof a === "number" && typeof b === "number") {
    const lt = leftType ?? inferNumericType(a);
    const rt = rightType ?? inferNumericType(b);

    return {
      left: a,
      right: b,
      resultType: forceFloat
        ? "float"
        : ((lt === "float" || rt === "float") ? "float" : "int"),
    };
  }

  const A = coerceNumeric(a, leftType);
  const B = coerceNumeric(b, rightType);

  return {
    left: A.n,
    right: B.n,
    resultType: forceFloat ? "float" : combineNumericTypes(A.type, B.type),
  };
}

export function normalizeArithmeticResult(
  n: number,
  resultType: NumericType,
): number {
  if (n === 0) {
    if (resultType === "int") {
      return 0;
    }
    return isNegativeZero(n) ? -0 : 0;
  }
  return n;
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

export function toPlainNumber(v: unknown): unknown {
  if (v instanceof Number) {
    return Number(v);
  }
  return v;
}

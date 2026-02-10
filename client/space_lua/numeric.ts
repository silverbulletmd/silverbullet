import type { NumericType } from "./ast.ts";
import { luaToNumberDetailed } from "./tonumber.ts";
import { luaTypeName } from "./runtime.ts";

export interface LuaTaggedFloat {
  readonly value: number;
  readonly isFloat: true;
}

// Pre-allocated singletons for float zeros
const FLOAT_POS_ZERO: LuaTaggedFloat = { value: 0, isFloat: true };
const FLOAT_NEG_ZERO: LuaTaggedFloat = { value: -0, isFloat: true };

export const luaStringCoercionError: Error = new Error(
  "LuaStringCoercionError",
);

export function isNegativeZero(n: number): boolean {
  return n === 0 && 1 / n === -Infinity;
}

export function isTaggedFloat(v: unknown): v is LuaTaggedFloat {
  return v !== null && typeof v === "object" && (v as any).isFloat === true;
}

function makeFloat(n: number): LuaTaggedFloat {
  if (n === 0) {
    return isNegativeZero(n) ? FLOAT_NEG_ZERO : FLOAT_POS_ZERO;
  }
  return { value: n, isFloat: true };
}

// Box a zero with a given kind tag.
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
  return isNegativeZero(n) ? FLOAT_NEG_ZERO : FLOAT_POS_ZERO;
}

// Tag an integer-valued number as float.
// Only allocates for integer-valued results; non-integer floats
// (1.5, NaN, Inf) are already unambiguously float as plain `number`.
export function makeLuaFloat(n: number): any {
  if (!Number.isInteger(n)) {
    return n;
  }
  return makeFloat(n);
}

export function getZeroBoxKind(x: any): NumericType | undefined {
  if (isTaggedFloat(x)) {
    return "float";
  }
  return undefined;
}

// Unwrap a potentially tagged or boxed Number to a plain number.
export function untagNumber(n: any): number {
  if (typeof n === "number") return n;
  if (isTaggedFloat(n)) {
    return n.value;
  }
  return n;
}

export function coerceToNumber(v: unknown): number | null {
  if (typeof v === "number") {
    return v;
  }
  if (isTaggedFloat(v)) {
    return v.value;
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
  if (isTaggedFloat(n)) {
    return "float";
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

  if (isTaggedFloat(val)) {
    return { n: val.value, type: hint ?? "float" };
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

  // One tagged float, one plain number
  if (typeof a === "number" && isTaggedFloat(b)) {
    return {
      left: a,
      right: b.value,
      resultType: "float",
    };
  }

  if (isTaggedFloat(a) && typeof b === "number") {
    return {
      left: a.value,
      right: b,
      resultType: "float",
    };
  }

  // Both tagged floats
  if (isTaggedFloat(a) && isTaggedFloat(b)) {
    return {
      left: a.value,
      right: b.value,
      resultType: "float",
    };
  }

  // General fallback
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
  if (isTaggedFloat(v)) {
    const n = v.value;
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

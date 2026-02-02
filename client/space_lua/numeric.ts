import type { NumericType } from "./ast.ts";
import { luaToNumberDetailed } from "./tonumber.ts";
import { luaTypeName } from "./runtime.ts";

export const luaZeroKind: unique symbol = Symbol("LuaZeroKind");

export type LuaZero = object & {
  [luaZeroKind]: "float";
};

export type LuaNumber = number | LuaZero;

export function makeLuaZero(
  n: number,
  numericType: NumericType,
): LuaNumber {
  if (n !== 0) {
    return n;
  }
  if (numericType !== "float") {
    return 0;
  }
  const z = new Number(n) as unknown as Record<PropertyKey, unknown>;
  z[luaZeroKind] = "float";
  return z as unknown as LuaZero;
}

export function isLuaZero(v: unknown): v is LuaZero {
  if (!(v instanceof Number)) {
    return false;
  }
  if (Number(v) !== 0) {
    return false;
  }
  return (v as unknown as Record<PropertyKey, unknown>)[luaZeroKind] ===
    "float";
}

export function luaZeroNumericType(v: unknown): NumericType | undefined {
  return isLuaZero(v) ? "float" : undefined;
}

// Marker error used to let the evaluator decide the final message.
export const luaStringCoercionError: Error = new Error(
  "LuaStringCoercionError",
);

export function isNegativeZero(n: number): boolean {
  return n === 0 && Object.is(n, -0);
}

export type LuaFloat = object & {
  [luaZeroKind]: "float";
};

export function makeLuaFloat(n: number): LuaFloat {
  const x = new Number(n) as unknown as Record<PropertyKey, unknown>;
  x[luaZeroKind] = "float";
  return x as unknown as LuaFloat;
}

export function isLuaFloat(v: unknown): v is LuaFloat {
  if (!(v instanceof Number)) {
    return false;
  }
  return (v as unknown as Record<PropertyKey, unknown>)[luaZeroKind] ===
    "float";
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

export function toPlainNumber(v: unknown): unknown {
  if (v instanceof Number) {
    return Number(v);
  }
  if (v && typeof v === "object") {
    const anyV = v as any;
    if (anyV.type === "float" && typeof anyV.value === "number") {
      return anyV.value;
    }
  }
  return v;
}

export function coerceToNumber(v: unknown): number | null {
  v = toPlainNumber(v);

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

export function toInteger(v: unknown): number | null {
  v = toPlainNumber(v);

  if (typeof v === "number") {
    if (!Number.isInteger(v)) {
      return null;
    }
    return v;
  }

  if (v instanceof Number) {
    const n = Number(v);
    if (!Number.isInteger(n)) {
      return null;
    }
    return n;
  }

  return null;
}

export type CoerceNumericResult = {
  n: number;
  type: NumericType;
};

export function coerceNumeric(
  val: unknown,
  hint?: NumericType,
): CoerceNumericResult {
  val = toPlainNumber(val);

  if (typeof val === "number") {
    return { n: val, type: hint ?? inferNumericType(val) };
  }

  if (val instanceof Number) {
    const n = Number(val);
    return { n, type: hint ?? inferNumericType(n) };
  }

  if (typeof val === "string") {
    const det = luaToNumberDetailed(val);
    if (!det) {
      // Let evaluator produce the final error message
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

  // Fast path with inlined type inference
  if (typeof a === "number" && typeof b === "number") {
    const lt = leftType ?? (
      !Number.isFinite(a) || Object.is(a, -0) || !Number.isInteger(a)
        ? "float"
        : "int"
    );
    const rt = rightType ?? (
      !Number.isFinite(b) || Object.is(b, -0) || !Number.isInteger(b)
        ? "float"
        : "int"
    );

    return {
      left: a,
      right: b,
      resultType: forceFloat
        ? "float"
        : ((lt === "float" || rt === "float") ? "float" : "int"),
    };
  }

  // Slow path
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
    return Object.is(n, -0) ? -0 : 0;
  }
  return n;
}

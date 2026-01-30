import type { NumericType } from "./ast.ts";
import { luaToNumberDetailed } from "./tonumber.ts";
import { luaTypeName } from "./runtime.ts";

export const ZeroBoxKind = Symbol("ZeroBox");

export type LuaFloatTag = {
  readonly type: "float";
  readonly value: number;
};

export function isBoxedZero(x: any): boolean {
  return x instanceof Number && Number(x) === 0 && !isNegativeZero(Number(x));
}

export function getZeroBoxKind(x: any): NumericType | undefined {
  return isBoxedZero(x)
    ? (x as any)[ZeroBoxKind] as NumericType | undefined
    : undefined;
}

export function boxZero(kind: NumericType): number {
  const z = new Number(0);
  (z as any)[ZeroBoxKind] = kind;
  return z as unknown as number;
}

export function isFloatTag(v: any): v is LuaFloatTag {
  return v && typeof v === "object" && v.type === "float";
}

// Tag an integer-valued number as a float:
// * zero: returns boxed float zero,
// * integer: returns tagged float,
// * non-integer: returns plain number.
export function floatLiteral(n: number): number | LuaFloatTag {
  if (n === 0 && !isNegativeZero(n)) {
    return boxZero("float");
  }
  if (Number.isInteger(n)) {
    return { type: "float" as const, value: n };
  }
  return n;
}

export function untagNumber(n: any): number {
  if (isFloatTag(n)) {
    return n.value;
  }
  if (n instanceof Number) {
    return Number(n);
  }
  return n;
}

export function getNumericKind(
  n: number | LuaFloatTag | any,
): NumericType | undefined {
  if (isFloatTag(n)) {
    return "float";
  }
  if (typeof n === "number") {
    return Number.isInteger(n) ? "int" : "float";
  }
  if (n instanceof Number) {
    const kind = getZeroBoxKind(n);
    if (kind) {
      return kind;
    }
    return Number.isInteger(Number(n)) ? "int" : "float";
  }
  return undefined;
}

export type OpHints = {
  leftKind?: NumericType;
  rightKind?: NumericType;
};

export const luaStringCoercionError: Error = new Error(
  "LuaStringCoercionError",
);

export function isNegativeZero(x: number): boolean {
  // faster than `Object.is(<object>, -0)`
  return x === 0 && 1 / x === -Infinity;
}

function produceNegativeZero() {
  return { n: -0, isInt: false, zeroKind: "float" as const };
}

export function coerceNumeric(
  val: unknown,
): {
  n: number;
  isInt: boolean;
  zeroKind?: NumericType;
} {
  if (isFloatTag(val)) {
    const n = val.value;
    if (n === 0) {
      if (isNegativeZero(n)) {
        return produceNegativeZero();
      }
      return { n: 0, isInt: false, zeroKind: "float" };
    }
    return { n, isInt: Number.isInteger(n), zeroKind: "float" };
  }

  if (isBoxedZero(val)) {
    return { n: 0, isInt: true, zeroKind: getZeroBoxKind(val)! };
  }

  if (typeof val === "number") {
    const n = val;
    if (n === 0) {
      if (isNegativeZero(n)) {
        return produceNegativeZero();
      }
      return {
        n,
        isInt: true,
      };
    }
    return {
      n,
      isInt: Number.isInteger(n),
    };
  }

  if (val instanceof Number) {
    const n = Number(val);
    if (n === 0 && !isNegativeZero(n)) {
      return {
        n,
        isInt: true,
        zeroKind: getZeroBoxKind(val),
      };
    }
    return {
      n,
      isInt: Number.isInteger(n),
    };
  }

  if (typeof val === "string") {
    const det = luaToNumberDetailed(val);
    if (!det) {
      throw luaStringCoercionError;
    }

    const n = det.value;
    const isInt = det.numericType === "int";

    if (n === 0) {
      if (isNegativeZero(n)) {
        return produceNegativeZero();
      }
      return {
        n,
        isInt,
        zeroKind: det.numericType,
      };
    }

    return {
      n,
      isInt,
    };
  }

  throw new Error(
    `attempt to perform arithmetic on a ${luaTypeName(val)} value`,
  );
}

export function coerceNumericPair(
  a: unknown,
  b: unknown,
  hints?: OpHints,
): {
  ax: number;
  bx: number;
  bothInt: boolean;
  aZeroKind?: NumericType;
  bZeroKind?: NumericType;
} {
  const A = coerceNumeric(a);
  const B = coerceNumeric(b);

  const aIsInt = hints?.leftKind
    ? hints.leftKind === "int"
    : (A.zeroKind ? A.zeroKind === "int" : A.isInt);

  const bIsInt = hints?.rightKind
    ? hints.rightKind === "int"
    : (B.zeroKind ? B.zeroKind === "int" : B.isInt);

  return {
    ax: A.n,
    bx: B.n,
    bothInt: aIsInt && bIsInt,
    aZeroKind: A.zeroKind,
    bZeroKind: B.zeroKind,
  };
}

import type { NumericType } from "./ast.ts";
import { luaToNumberDetailed } from "./tonumber.ts";

export const ZeroBoxKind = Symbol("ZeroBox");

export function isBoxedZero(x: any): boolean {
  return x instanceof Number && Number(x) === 0 && !Object.is(Number(x), -0);
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

export type OpHints = {
  leftKind?: NumericType;
  rightKind?: NumericType;
};

function luaTypeName(val: unknown): string {
  if (val === null || val === undefined) return "nil";
  if (typeof val === "boolean") return "boolean";
  if (typeof val === "number" || val instanceof Number) return "number";
  if (typeof val === "string") return "string";
  if (typeof val === "function") return "function";
  if (Array.isArray(val)) return "table";

  if (typeof val === "object") {
    return "table";
  }

  return typeof val;
}

export function coerceNumeric(
  val: unknown,
): {
  n: number;
  isInt: boolean;
  zeroKind?: NumericType;
} {
  if (isBoxedZero(val)) {
    return { n: 0, isInt: true, zeroKind: getZeroBoxKind(val)! };
  }

  if (typeof val === "number") {
    const n = val;
    if (n === 0) {
      if (Object.is(n, -0)) {
        return {
          n,
          isInt: true,
          zeroKind: "float",
        };
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
    if (n === 0 && !Object.is(n, -0)) {
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
      // Kept generic for evaluator upgrades string-related arithmetic
      // failures depending on operator/operand types.
      throw new Error(`attempt to perform arithmetic on a string value`);
    }

    const n = det.value;
    const isInt = det.numericType === "int";
    if (n === 0) {
      if (Object.is(n, -0)) {
        return {
          n,
          isInt,
          zeroKind: "float",
        };
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

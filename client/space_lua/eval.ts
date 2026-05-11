import type {
  ASTCtx,
  LuaBlock,
  LuaExpression,
  LuaFromField,
  LuaFunctionCallExpression,
  LuaLValue,
  LuaLeadingClause,
  LuaStatement,
  LuaTableField,
  NumericType,
} from "./ast.ts";
import { LuaAttribute } from "./ast.ts";
import {
  asAssignment,
  asBinary,
  asBlock,
  asFor,
  asForIn,
  asFunctionCall,
  asFunctionCallStmt,
  asFunctionDef,
  asFunctionStmt,
  asGoto,
  asIf,
  asLabel,
  asLocal,
  asLocalFunction,
  asLValuePropertyAccess,
  asLValueTableAccess,
  asLValueVariable,
  asParenthesized,
  asPropertyAccess,
  asQueryExpr,
  asRepeat,
  asReturn,
  asTableAccess,
  asTableConstructor,
  asUnary,
  asVariable,
  asWhile,
} from "./ast_narrow.ts";
import {
  applyPushedFilters,
  attachAnalyzeQueryOpStats,
  buildExplainScanNode,
  buildJoinTree,
  buildLeadingHintInfo,
  buildNormalizationInfoBySource,
  computeResultColumns,
  type ExplainNode,
  type ExplainOptions,
  type ExplainResult,
  executeAndInstrument,
  executeJoinTree,
  explainJoinTree,
  exprToDisplayString,
  exprToString,
  extractEquiPredicates,
  extractRangePredicates,
  extractSingleSourceFilters,
  formatExplainOutput,
  formatPrunedConjuncts,
  generateTransitivePredicates,
  pruneAlwaysTrueConjuncts,
  type JoinPlannerConfig,
  type JoinSource,
  type SourceNormalizationInfo,
  stripUsedJoinPredicates,
  validatePostJoinSourceReferences,
  wrapPlanWithQueryOps,
} from "./join_planner.ts";
import { getBlockGotoMeta } from "./labels.ts";
import {
  coerceNumericPair,
  coerceToNumber,
  inferNumericType,
  isNegativeZero,
  isTaggedFloat,
  luaStringCoercionError,
  makeLuaFloat,
  makeLuaZero,
  normalizeArithmeticResult,
  toInteger,
  untagNumber,
} from "./numeric.ts";
import {
  collectionHasPlannerCapability,
  computeStatsFromArray,
  makeExecutionCapabilities,
  toCollection,
  type AggregateRuntimeInstrumentation,
  type CollectionStats,
  type EngineDispatchReport,
  type LuaCollectionQuery,
  type LuaGroupByEntry,
  type PushdownNarrowingReport,
  type QueryEngineCapability,
  type QueryInstrumentation,
  type QueryStageStat,
} from "./query_collection.ts";
import { ARRAY_SCAN_ENGINE_CAPABILITY } from "./array_scan_engine.ts";
import { COMPUTE_FALLBACK_ENGINE_CAPABILITY } from "./compute_fallback_engine.ts";
import { isPromise, rpAll, rpThen } from "./rp.ts";
import {
  getMetatable,
  type ILuaFunction,
  type ILuaGettable,
  isILuaFunction,
  jsToLuaValue,
  LuaEnv,
  LuaFunction,
  type LuaLValueContainer,
  LuaMultiRes,
  LuaRuntimeError,
  type LuaStackFrame,
  LuaTable,
  type LuaType,
  type LuaValue,
  luaCall,
  luaCloseFromMark,
  luaEnsureCloseStack,
  luaEquals,
  luaFormatNumber,
  luaGet,
  luaIndexValue,
  luaKeys,
  luaMarkToBeClosed,
  luaSet,
  luaTruthy,
  luaTypeName,
  luaTypeOf,
  luaValueToJS,
  singleResult,
} from "./runtime.ts";
import { evalPromiseValues } from "./util.ts";

const astNumberKindCache = new WeakMap<LuaExpression, NumericType>();

function astNumberKind(e: LuaExpression | undefined): NumericType | undefined {
  if (!e) return undefined;

  const cached = astNumberKindCache.get(e);
  if (cached) return cached;

  let unwrapped = e;
  while (unwrapped.type === "Parenthesized") {
    unwrapped = unwrapped.expression;
  }

  let result: NumericType | undefined;

  if (unwrapped.type === "Unary" && unwrapped.operator === "-") {
    result = astNumberKind(unwrapped.argument);
  } else if (unwrapped.type === "Number") {
    result = unwrapped.numericType === "int" ? "int" : "float";
  } else if (unwrapped.type === "Binary") {
    const op = unwrapped.operator;
    const numericOp =
      op === "+" ||
      op === "-" ||
      op === "*" ||
      op === "/" ||
      op === "//" ||
      op === "%" ||
      op === "^";

    if (numericOp) {
      const lk = astNumberKind(unwrapped.left);
      const rk = astNumberKind(unwrapped.right);

      if (lk === "float" || rk === "float") {
        result = "float";
      } else if (lk === "int" && rk === "int") {
        result = "int";
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }

  if (result !== undefined) {
    astNumberKindCache.set(e, result);
  }

  return result;
}

type GotoSignal = { ctrl: "goto"; target: string };
type ReturnSignal = { ctrl: "return"; values: LuaValue[] };
type BreakSignal = { ctrl: "break" };
type ControlSignal = GotoSignal | ReturnSignal | BreakSignal;

function isGotoSignal(v: any): v is GotoSignal {
  return !!v && typeof v === "object" && v.ctrl === "goto";
}

function isBreakSignal(v: any): v is BreakSignal {
  return !!v && typeof v === "object" && v.ctrl === "break";
}

function consumeGotoInBlock(
  res: any,
  labels: Map<string, number>,
): number | any | undefined {
  if (res === undefined) {
    return undefined;
  }
  if (isGotoSignal(res)) {
    const labelIdx = labels.get(res.target);
    if (labelIdx !== undefined) {
      return labelIdx + 1; // next statement
    }
  }
  return res;
}

function blockMetaOrThrow(
  block: LuaBlock,
  sf: LuaStackFrame,
): ReturnType<typeof getBlockGotoMeta> {
  try {
    return getBlockGotoMeta(block);
  } catch (e: any) {
    if (e && typeof e === "object" && "astCtx" in e) {
      throw new LuaRuntimeError(e.message, sf.withCtx((e as any).astCtx));
    }
    throw e;
  }
}

function arithVerbFromOperator(op: string): string | null {
  switch (op) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
      return "mul";
    case "/":
      return "div";
    case "//":
      return "idiv";
    case "%":
      return "mod";
    case "^":
      return "pow";
    default:
      return null;
  }
}

function isNumericBinaryOp(op: string): boolean {
  return (
    op === "+" ||
    op === "-" ||
    op === "*" ||
    op === "/" ||
    op === "//" ||
    op === "%" ||
    op === "^"
  );
}

function arithCoercionErrorOrThrow(
  op: string,
  left: any,
  right: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
  e: any,
): never {
  if (e === luaStringCoercionError) {
    const mapped = maybeLuaArithStringError(op, left, right, ctx, sf);
    if (mapped) {
      throw mapped;
    }
    throw new LuaRuntimeError(
      "attempt to perform arithmetic on a string value",
      sf.withCtx(ctx),
    );
  }

  const mapped = maybeLuaArithStringError(op, left, right, ctx, sf);
  if (mapped) {
    throw mapped;
  }

  throw e;
}

export function luaOp(
  op: string,
  left: any,
  right: any,
  leftType: NumericType | undefined,
  rightType: NumericType | undefined,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  switch (op) {
    case "+": {
      // Ultra-fast path: both plain numbers with no float type annotation (int + int)
      if (
        typeof left === "number" &&
        typeof right === "number" &&
        leftType !== "float" &&
        rightType !== "float"
      ) {
        return left + right;
      }
      return luaArithGeneric("+", left, right, leftType, rightType, ctx, sf);
    }
    case "-": {
      if (
        typeof left === "number" &&
        typeof right === "number" &&
        leftType !== "float" &&
        rightType !== "float"
      ) {
        const r = left - right;
        return r === 0 ? 0 : r;
      }
      return luaArithGeneric("-", left, right, leftType, rightType, ctx, sf);
    }
    case "*": {
      if (
        typeof left === "number" &&
        typeof right === "number" &&
        leftType !== "float" &&
        rightType !== "float"
      ) {
        const r = left * right;
        return r === 0 ? 0 : r;
      }
      return luaArithGeneric("*", left, right, leftType, rightType, ctx, sf);
    }
    case "/":
    case "^": {
      return luaArithGeneric(
        op as NumericArithOp,
        left,
        right,
        leftType,
        rightType,
        ctx,
        sf,
      );
    }
    case "..": {
      // Fast path: string .. string (most common in SilverBullet — key building, templates)
      if (typeof left === "string" && typeof right === "string") {
        return left + right;
      }
      // Fast path: string .. number or number .. string
      if (typeof left === "string" && typeof right === "number") {
        return left + luaFormatNumber(right);
      }
      if (typeof left === "number" && typeof right === "string") {
        return luaFormatNumber(left) + right;
      }
      try {
        const coerce = (v: any): string => {
          if (v === null || v === undefined) {
            throw new LuaRuntimeError(
              "attempt to concatenate a nil value",
              sf.withCtx(ctx),
            );
          }
          if (typeof v === "string") {
            return v as string;
          }
          if (typeof v === "number") {
            return luaFormatNumber(v);
          }
          if (isTaggedFloat(v)) {
            return luaFormatNumber(v.value, "float");
          }
          const t = luaTypeName(v);
          throw new LuaRuntimeError(
            `attempt to concatenate a ${t} value`,
            sf.withCtx(ctx),
          );
        };
        return coerce(left) + coerce(right);
      } catch (e: any) {
        const meta = evalMetamethod(left, right, "__concat", ctx, sf);
        if (meta !== undefined) {
          return meta;
        }
        throw e;
      }
    }
    case "==": {
      // Fast path for same-type primitives
      if (typeof left === typeof right && typeof left !== "object") {
        return left === right;
      }
      if (luaEquals(left, right)) return true;
      return luaEqWithMetamethod(left, right, ctx, sf);
    }
    case "~=":
    case "!=": {
      if (typeof left === typeof right && typeof left !== "object") {
        return left !== right;
      }
      if (luaEquals(left, right)) {
        return false;
      }
      return !luaEqWithMetamethod(left, right, ctx, sf);
    }
    case "<": {
      // Fast path: both plain numbers
      if (typeof left === "number" && typeof right === "number") {
        return left < right;
      }
      // Fast path: both strings
      if (typeof left === "string" && typeof right === "string") {
        return left < right;
      }
      return luaRelWithMetamethod("<", left, right, ctx, sf);
    }
    case "<=": {
      if (typeof left === "number" && typeof right === "number")
        return left <= right;
      if (typeof left === "string" && typeof right === "string")
        return left <= right;
      return luaRelWithMetamethod("<=", left, right, ctx, sf);
    }
    // Lua: `a>b` is `b<a`, `a>=b` is `b<=a`
    case ">": {
      if (typeof left === "number" && typeof right === "number")
        return left > right;
      if (typeof left === "string" && typeof right === "string")
        return left > right;
      return luaRelWithMetamethod("<", right, left, ctx, sf);
    }
    case ">=": {
      if (typeof left === "number" && typeof right === "number")
        return left >= right;
      if (typeof left === "string" && typeof right === "string")
        return left >= right;
      return luaRelWithMetamethod("<=", right, left, ctx, sf);
    }
  }

  // Remaining operators: //, %, bitwise
  const handler = operatorsMetaMethods[op];
  if (!handler) {
    throw new LuaRuntimeError(`Unknown operator ${op}`, sf.withCtx(ctx));
  }

  try {
    return handler.nativeImplementation(
      left,
      right,
      leftType,
      rightType,
      ctx,
      sf,
    );
  } catch (e: any) {
    if (handler.metaMethod) {
      const meta = evalMetamethod(left, right, handler.metaMethod, ctx, sf);
      if (meta !== undefined) {
        return meta;
      }
    }
    return arithCoercionErrorOrThrow(op, left, right, ctx, sf, e);
  }
}

function luaArithGeneric(
  op: NumericArithOp,
  left: any,
  right: any,
  leftType: NumericType | undefined,
  rightType: NumericType | undefined,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  const ar = numericArith[op];
  try {
    const {
      left: l,
      right: r,
      resultType,
    } = coerceNumericPair(left, right, leftType, rightType, op);

    let result = ar.f(l, r);

    if (
      ar.special === "sub" &&
      result === 0 &&
      isNegativeZero(result) &&
      resultType === "float"
    ) {
      const rhsIsIntZero = r === 0 && rightType === "int";
      if (rhsIsIntZero) {
        result = 0;
      }
    }

    const normalized = normalizeArithmeticResult(result, resultType);

    // Operators `/` and `^` produce float, wrap only if needed.
    if (op === "/" || op === "^") {
      if (normalized === 0) {
        return makeLuaZero(normalized, "float");
      }
      if (!Number.isFinite(normalized)) {
        return normalized;
      }
      if (!Number.isInteger(normalized)) {
        return normalized;
      }
      return makeLuaFloat(normalized);
    }

    if (normalized === 0) {
      return makeLuaZero(normalized, resultType);
    }
    if (resultType === "float" && Number.isInteger(normalized)) {
      return makeLuaFloat(normalized);
    }
    return normalized;
  } catch (e: any) {
    const meta = evalMetamethod(left, right, ar.metaMethod, ctx, sf);
    if (meta !== undefined) {
      return meta;
    }
    return arithCoercionErrorOrThrow(op, left, right, ctx, sf, e);
  }
}

type NumericArithOp = "+" | "-" | "*" | "/" | "^";

const numericArith: Record<
  NumericArithOp,
  {
    metaMethod: "__add" | "__sub" | "__mul" | "__div" | "__pow";
    f: (l: number, r: number) => number;
    special?: "sub";
  }
> = {
  "+": { metaMethod: "__add", f: (l, r) => l + r },
  "-": { metaMethod: "__sub", f: (l, r) => l - r, special: "sub" },
  "*": { metaMethod: "__mul", f: (l, r) => l * r },
  "/": { metaMethod: "__div", f: (l, r) => l / r },
  "^": { metaMethod: "__pow", f: (l, r) => l ** r },
};

function maybeLuaArithStringError(
  op: string,
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaRuntimeError | null {
  const verb = arithVerbFromOperator(op);
  if (!verb) {
    return null;
  }

  const ta = luaTypeName(a);
  const tb = luaTypeName(b);

  if (ta === "string" || tb === "string") {
    return new LuaRuntimeError(
      `attempt to ${verb} a '${ta}' with a '${tb}'`,
      sf.withCtx(ctx),
    );
  }

  return null;
}

function luaFloorDiv(
  a: unknown,
  b: unknown,
  leftType: NumericType | undefined,
  rightType: NumericType | undefined,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  const { left, right, resultType } = coerceNumericPair(
    a,
    b,
    leftType,
    rightType,
    "//",
  );

  if (resultType === "int" && right === 0) {
    throw new LuaRuntimeError(`attempt to divide by zero`, sf.withCtx(ctx));
  }

  const result = Math.floor(left / right);
  const normalized = normalizeArithmeticResult(result, resultType);
  if (normalized === 0) {
    return makeLuaZero(normalized, resultType);
  }
  if (resultType === "float" && Number.isInteger(normalized)) {
    return makeLuaFloat(normalized);
  }
  return normalized;
}

function luaMod(
  a: unknown,
  b: unknown,
  leftType: NumericType | undefined,
  rightType: NumericType | undefined,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  const { left, right, resultType } = coerceNumericPair(
    a,
    b,
    leftType,
    rightType,
    "%",
  );

  if (resultType === "int" && right === 0) {
    throw new LuaRuntimeError(`attempt to perform 'n%0'`, sf.withCtx(ctx));
  }

  const q = Math.floor(left / right);
  const result = left - q * right;

  // Preserve -0.0 from left operand in float mode
  if (result === 0 && resultType === "float" && isNegativeZero(left)) {
    return makeLuaZero(-0, "float");
  }

  const normalized = normalizeArithmeticResult(result, resultType);
  if (normalized === 0) {
    return makeLuaZero(normalized, resultType);
  }
  if (resultType === "float" && Number.isInteger(normalized)) {
    return makeLuaFloat(normalized);
  }
  return normalized;
}

function luaUnaryMinus(v: number, numType: NumericType | undefined): number {
  const vType = numType ?? inferNumericType(v);

  if (v === 0 && vType === "int") {
    return 0;
  }

  if (v === 0 && vType === "float") {
    return isNegativeZero(v) ? 0 : -0;
  }

  return -v;
}

const operatorsMetaMethods: Record<
  string,
  {
    metaMethod?: string;
    nativeImplementation: (
      a: LuaValue,
      b: LuaValue,
      leftType: NumericType | undefined,
      rightType: NumericType | undefined,
      ctx: ASTCtx,
      sf: LuaStackFrame,
    ) => LuaValue;
  }
> = {
  "//": {
    metaMethod: "__idiv",
    nativeImplementation: (a, b, lt, rt, ctx, sf) =>
      luaFloorDiv(a, b, lt, rt, ctx, sf),
  },
  "%": {
    metaMethod: "__mod",
    nativeImplementation: (a, b, lt, rt, ctx, sf) =>
      luaMod(a, b, lt, rt, ctx, sf),
  },
  "&": {
    metaMethod: "__band",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt & bInt;
    },
  },
  "|": {
    metaMethod: "__bor",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt | bInt;
    },
  },
  "~": {
    metaMethod: "__bxor",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt ^ bInt;
    },
  },
  "<<": {
    metaMethod: "__shl",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt << bInt;
    },
  },
  ">>": {
    metaMethod: "__shr",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt >> bInt;
    },
  },
};

// Multi-source: qualify as `src_col`; single-source: bare property names.
function deriveFieldName(
  e: LuaExpression,
  sourceNames: readonly string[] | undefined,
): string | undefined {
  switch (e.type) {
    case "Variable":
      return e.name;
    case "PropertyAccess":
      if (e.object.type === "Variable") {
        const obj = e.object.name;
        if (
          sourceNames &&
          sourceNames.length > 1 &&
          sourceNames.includes(obj)
        ) {
          return `${obj}_${e.property}`;
        }
      }
      return e.property;
    case "FunctionCall":
      if (e.name) return e.name;
      if (e.prefix.type === "Variable") return e.prefix.name;
      if (e.prefix.type === "PropertyAccess") return e.prefix.property;
      return undefined;
    case "FilteredCall":
      return deriveFieldName(e.call, sourceNames);
    case "AggregateCall":
      return deriveFieldName((e as any).call, sourceNames);
    default:
      return undefined;
  }
}

function fieldsToExpression(
  fields: LuaTableField[],
  ctx: ASTCtx,
  sourceNames?: readonly string[],
): LuaExpression {
  if (fields.length === 1 && fields[0].type === "ExpressionField") {
    return fields[0].value;
  }
  const used = new Set<string>();
  for (const f of fields) {
    if (f.type === "PropField") {
      used.add(f.key);
    } else if (f.type === "DynamicField" && f.key.type === "String") {
      used.add(f.key.value);
    }
  }
  const promoted: LuaTableField[] = fields.map((f) => {
    if (f.type !== "ExpressionField") return f;
    const base = deriveFieldName(f.value, sourceNames);
    if (!base) return f;
    let key = base;
    let n = 2;
    while (used.has(key)) {
      key = `${base}_${n++}`;
    }
    used.add(key);
    return {
      type: "PropField",
      key,
      value: f.value,
      ctx: f.ctx,
    } as LuaTableField;
  });
  return { type: "TableConstructor", fields: promoted, ctx };
}

function functionNameForSqlError(fc: LuaFunctionCallExpression): string {
  if (fc.prefix.type === "Variable") {
    const base = asVariable(fc.prefix).name;
    return fc.name ? `${base}.${fc.name}` : base;
  }
  return "(function)";
}

function fieldsToGroupByEntries(
  fields: LuaTableField[],
  sf: LuaStackFrame,
): LuaGroupByEntry[] {
  return fields.map((f) => {
    switch (f.type) {
      case "PropField":
        return { kind: "expr", expr: f.value, alias: f.key };
      case "ExpressionField":
        return { kind: "expr", expr: f.value };
      case "DynamicField":
        throw new LuaRuntimeError(
          "dynamic entry in 'group by' clause is not allowed",
          sf.withCtx(f.ctx),
        );
      case "StarField":
        return { kind: "wildcardAll" };
      case "StarSourceField":
        return { kind: "wildcardSource", source: f.source };
      case "StarColumnField":
        throw new LuaRuntimeError(
          "wildcard column reference is not allowed in 'group by' clause",
          sf.withCtx(f.ctx),
        );
    }
  });
}

type FromSource =
  | {
      kind: "single";
      objectVariable?: string;
      expression: LuaExpression;
      materialized?: boolean;
      withHints?: LuaFromField["withHints"];
    }
  | {
      kind: "cross";
      sources: JoinSource[];
    };

function fromFieldsToSource(fields: LuaFromField[], ctx: ASTCtx): FromSource {
  if (fields.length === 1) {
    const f = fields[0];
    if (f.type === "ExpressionField") {
      return {
        kind: "single",
        expression: f.value,
        materialized: f.materialized === true,
        withHints: f.withHints,
      };
    }
    if (f.type === "PropField") {
      return {
        kind: "single",
        objectVariable: f.key,
        expression: f.value,
        materialized: f.materialized === true,
        withHints: f.withHints,
      };
    }
  }

  const sources: JoinSource[] = [];
  for (const f of fields) {
    if (f.type !== "PropField") {
      throw new LuaRuntimeError(
        "each 'from' clause entry must be a named source (alias = expression)",
        {
          ref: ctx,
        } as any,
      );
    }
    sources.push({
      name: f.key,
      expression: f.value,
      hint: f.joinHint,
      materialized: f.materialized === true,
      withHints: f.withHints,
    });
  }
  return { kind: "cross", sources };
}

/**
 * Walk wrapper nodes (Limit, Sort, GroupAggregate, Filter, Unique) to find the
 * underlying join/scan plan that executeAndInstrument operates on.
 */
function unwrapToJoinPlan(node: ExplainNode): ExplainNode {
  if (
    node.nodeType === "Limit" ||
    node.nodeType === "Sort" ||
    node.nodeType === "GroupAggregate" ||
    node.nodeType === "Filter" ||
    node.nodeType === "Project" ||
    node.nodeType === "Unique"
  ) {
    return unwrapToJoinPlan(node.children[0]);
  }
  return node;
}

function collectExplainWrapperNodes(plan: ExplainNode): ExplainNode[] {
  const nodes: ExplainNode[] = [];

  const visit = (node: ExplainNode): void => {
    if (node.children.length > 0) {
      visit(node.children[0]);
    }

    switch (node.nodeType) {
      case "Filter":
      case "GroupAggregate":
      case "Project":
      case "Unique":
      case "Sort":
      case "Limit":
        nodes.push(node);
        break;
    }
  };

  visit(plan);
  return nodes;
}

function wrapperNodeStageName(
  node: ExplainNode,
): QueryStageStat["stage"] | null {
  switch (node.nodeType) {
    case "Filter":
      return node.havingExpr ? "having" : node.whereExpr ? "where" : null;
    case "GroupAggregate":
      return "groupBy";
    case "Project":
      return "select";
    case "Unique":
      return "distinct";
    case "Sort":
      return "orderBy";
    case "Limit":
      return "limit";
    default:
      return null;
  }
}

// Wrapper stats align with pipeline order:
// where -> group -> having -> distinct -> order -> limit
function annotateExplainWrappersFromStageStats(
  plan: ExplainNode,
  stageStats: QueryStageStat[],
  execStartedAt: number,
  opts: ExplainOptions,
): void {
  const wrapperNodes = collectExplainWrapperNodes(plan);
  const used = new Set<number>();

  for (const node of wrapperNodes) {
    const wantedStage = wrapperNodeStageName(node);
    if (!wantedStage) continue;

    const statIdx = stageStats.findIndex(
      (s, i) => !used.has(i) && s.stage === wantedStage,
    );
    if (statIdx === -1) continue;

    used.add(statIdx);
    const stat = stageStats[statIdx];

    node.actualRows = stat.outputRows;
    node.actualLoops = 1;

    if (wantedStage === "where" || wantedStage === "having") {
      node.rowsRemovedByFilter = stat.rowsRemoved;
    }

    if (wantedStage === "where" && stat.inlineFilteredRows) {
      node.rowsRemovedByInlineFilter = stat.inlineFilteredRows;
    }

    if (wantedStage === "distinct") {
      node.rowsRemovedByUnique = stat.rowsRemoved;
    }

    if (wantedStage === "orderBy") {
      node.memoryRows = stat.memoryRows ?? stat.inputRows;
    }

    if (opts.timing) {
      const startup =
        Math.round((stat.startTimeMs - execStartedAt) * 1000) / 1000;
      const total = Math.round((stat.endTimeMs - execStartedAt) * 1000) / 1000;
      node.actualStartupTimeMs = startup;
      node.actualTimeMs = total;
    }
  }

  for (const node of wrapperNodes) {
    if (node.actualLoops !== undefined) continue;
    const child = node.children[0];
    if (!child || child.actualLoops === undefined) continue;
    node.actualRows = child.actualRows;
    node.actualLoops = child.actualLoops;
    if (opts.timing) {
      node.actualStartupTimeMs = child.actualTimeMs;
      node.actualTimeMs = child.actualTimeMs;
    }
  }
}

/**
 * Build a LuaCollectionQuery from query clauses.  Shared by EXPLAIN,
 * EXPLAIN ANALYZE, and normal execution paths to ensure plan fidelity.
 *
 * When `overrides.where` is provided it replaces the 'where' clause expression
 * (used by the cross-join path to substitute the residual 'where' after
 * join-predicate stripping).
 */
async function buildQueryFromClauses(
  q: ReturnType<typeof asQueryExpr>,
  env: LuaEnv,
  sf: LuaStackFrame,
  overrides?: { where?: LuaExpression },
): Promise<LuaCollectionQuery> {
  const query: LuaCollectionQuery = {
    distinct: true,
  };

  const fromClause = q.clauses.find((c) => c.type === "From");
  const fromSourceNames: string[] = fromClause
    ? fromClause.fields.flatMap((f) => (f.type === "PropField" ? [f.key] : []))
    : [];

  for (const clause of q.clauses) {
    switch (clause.type) {
      case "Where":
        query.where =
          overrides && "where" in overrides
            ? overrides.where
            : clause.expression;
        break;
      case "OrderBy":
        query.orderBy = clause.orderBy.map((o) => {
          const desc = o.direction === "desc";
          if (o.wildcard) {
            return {
              wildcard: o.wildcard,
              desc,
              nulls: o.nulls,
              using: o.using,
              ctx: o.ctx,
            };
          }
          return {
            expr: o.expression!,
            desc,
            nulls: o.nulls,
            using: o.using,
            ctx: o.ctx,
          };
        });
        break;
      case "Limit": {
        const lv = await evalExpression(clause.limit, env, sf);
        query.limit = Number(lv);
        if (clause.offset) {
          const ov = await evalExpression(clause.offset, env, sf);
          query.offset = Number(ov);
        }
        break;
      }
      case "Offset": {
        const ov = await evalExpression(clause.offset, env, sf);
        query.offset = Number(ov);
        break;
      }
      case "GroupBy":
        query.groupBy = fieldsToGroupByEntries(clause.fields, sf);
        break;
      case "Having":
        query.having = clause.expression;
        break;
      case "Select":
        query.select = fieldsToExpression(
          clause.fields,
          clause.ctx,
          fromSourceNames,
        );
        query.distinct = clause.distinct !== false;
        break;
    }
  }

  if (!query.select) {
    const fromClause = q.clauses.find((c) => c.type === "From");
    if (fromClause && fromClause.fields.length > 1) {
      query.select = {
        type: "TableConstructor",
        fields: [{ type: "StarField", ctx: fromClause.ctx }],
        ctx: fromClause.ctx,
      };
    }
  }

  return query;
}

function unknownDefaultStats(): CollectionStats {
  return {
    rowCount: 100,
    ndv: new Map(),
    avgColumnCount: 5,
    statsSource: "unknown-default",
    executionCapabilities: makeExecutionCapabilities("kv", ["scan-kv"]),
  };
}

function normalizeProvidedStats(stats: CollectionStats): CollectionStats {
  if (stats.statsSource) {
    return stats;
  }

  return {
    ...stats,
    statsSource: "source-provided-unknown",
  };
}

async function getStatsForValue(
  val: LuaValue,
  _env: LuaEnv,
  _sf: LuaStackFrame,
): Promise<CollectionStats> {
  if (
    val &&
    typeof val === "object" &&
    "getStats" in val &&
    typeof (val as any).getStats === "function"
  ) {
    const stats = await (val as any).getStats();
    if (stats) {
      return normalizeProvidedStats(stats);
    }
  }

  if (
    val &&
    typeof val === "object" &&
    "query" in val &&
    typeof (val as any).query === "function"
  ) {
    return unknownDefaultStats();
  }

  if (val === null || val === undefined) {
    return computeStatsFromArray([]);
  }

  if (Array.isArray(val)) {
    return computeStatsFromArray(val);
  }

  if (val instanceof LuaTable) {
    return computeStatsFromArray(luaTableToArray(val));
  }

  return computeStatsFromArray([val]);
}

function explainSingleSource(
  sourceName: string,
  sourceExpression: LuaExpression,
  stats?: CollectionStats,
  withHints?: LuaFromField["withHints"],
  materialized?: boolean,
  pushedFilterExpr?: string,
  normalizationInfo?: SourceNormalizationInfo,
): ExplainNode {
  return buildExplainScanNode({
    sourceName,
    sourceExpression,
    stats,
    withHints,
    materialized,
    pushedFilterExpr,
    normalizationInfo,
  });
}

/**
 * Convert a LuaTable to a flat JS array.  Array-like tables (length > 0)
 * are unpacked; empty tables yield []; record-like tables are singletons.
 */
export function luaTableToArray(t: LuaTable): any[] {
  if (t.empty()) return [];
  if (t.length > 0) {
    const arr: any[] = [];
    for (let i = 1; i <= t.length; i++) {
      arr.push(t.rawGet(i));
    }
    return arr;
  }
  return [t];
}

async function materializeValueAsItems(
  val: LuaValue,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<any[]> {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return val;
  if (val instanceof LuaTable) return luaTableToArray(val);
  if (
    typeof val === "object" &&
    "query" in val &&
    typeof (val as any).query === "function"
  ) {
    return (val as any).query({}, env, sf);
  }
  return [val];
}

function collectionSupportsPredicateDelegation(
  stats: CollectionStats | undefined,
): boolean {
  return (
    collectionHasPlannerCapability(stats, "stage-where") &&
    (collectionHasPlannerCapability(stats, "pred-eq") ||
      collectionHasPlannerCapability(stats, "pred-neq") ||
      collectionHasPlannerCapability(stats, "pred-lt") ||
      collectionHasPlannerCapability(stats, "pred-lte") ||
      collectionHasPlannerCapability(stats, "pred-gt") ||
      collectionHasPlannerCapability(stats, "pred-gte") ||
      collectionHasPlannerCapability(stats, "pred-in"))
  );
}

export function evalExpression(
  e: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue> | LuaValue {
  try {
    switch (e.type) {
      case "String": {
        return e.value;
      }
      case "Number": {
        if (e.value === 0) {
          return makeLuaZero(e.value, e.numericType);
        }
        if (e.numericType === "float" && Number.isInteger(e.value)) {
          return makeLuaFloat(e.value);
        }
        return e.value;
      }
      case "Boolean": {
        return e.value;
      }
      case "Nil": {
        return null;
      }
      case "Binary": {
        const b = asBinary(e);
        if (b.operator === "or") {
          return evalLogical("or", b.left, b.right, env, sf);
        }
        if (b.operator === "and") {
          return evalLogical("and", b.left, b.right, env, sf);
        }
        return evalBinaryWithLR(b.operator, b.left, b.right, b.ctx, env, sf);
      }
      case "Unary": {
        const u = asUnary(e);

        // Fast path: negation of numeric literal
        if (u.operator === "-" && u.argument.type === "Number") {
          const num = u.argument;
          if (num.value === 0) {
            const z = num.numericType === "int" ? 0 : -0;
            return makeLuaZero(z, num.numericType);
          }
          if (num.numericType === "float" && Number.isInteger(num.value)) {
            return makeLuaFloat(-num.value);
          }
          return -num.value;
        }

        if (u.operator === "-") {
          const tv = evalExprWithNumericType(u.argument, env, sf, true);

          const applyTyped = (typed: TypedValue) => {
            const arg = singleResult(typed.value);

            return unaryWithMeta(arg, "__unm", u.ctx, sf, () => {
              // Numeric-string coercion for unary minus
              if (typeof arg === "string") {
                const n = coerceToNumber(arg);
                if (n === null) {
                  throw new LuaRuntimeError(
                    "attempt to unm a 'string' with a 'string'",
                    sf.withCtx(u.ctx),
                  );
                }
                if (n === 0) {
                  return 0;
                }
                return -n;
              }

              const plain = untagNumber(arg);
              if (typeof plain !== "number") {
                throw new LuaRuntimeError(
                  "attempt to perform arithmetic on a table value",
                  sf.withCtx(u.ctx),
                );
              }

              const argType = isTaggedFloat(arg)
                ? "float"
                : astNumberKind(u.argument);

              const out = luaUnaryMinus(plain, argType);

              // If the operand is a float-tagged boxed number, unary
              // minus must keep the result float-typed.
              if (isTaggedFloat(arg)) {
                if (out === 0) {
                  return makeLuaZero(out, "float");
                }
                return makeLuaFloat(out);
              }

              // Preserve numeric kind for zero results
              if (out === 0) {
                const outType = argType ?? inferNumericType(plain);
                return makeLuaZero(out, outType);
              }

              return out;
            });
          };

          return rpThen(tv as any, applyTyped);
        }

        const value = evalExpression(u.argument, env, sf);

        const applyUnary = (value: LuaValue) => {
          switch (u.operator) {
            case "not": {
              return !luaTruthy(value);
            }
            case "~": {
              const arg = singleResult(value);
              return unaryWithMeta(arg, "__bnot", u.ctx, sf, () => {
                const intVal = toInteger(arg);
                if (intVal === null) {
                  if (typeof arg === "string") {
                    throw new LuaRuntimeError(
                      `attempt to perform bitwise operation on a string value (constant '${arg}')`,
                      sf.withCtx(u.ctx),
                    );
                  }
                  const t = luaTypeName(arg);
                  if (t === "number") {
                    throw new LuaRuntimeError(
                      `number has no integer representation`,
                      sf.withCtx(u.ctx),
                    );
                  }
                  throw new LuaRuntimeError(
                    `attempt to perform bitwise operation on a ${t} value`,
                    sf.withCtx(u.ctx),
                  );
                }
                return ~intVal;
              });
            }
            case "#": {
              return luaLengthOp(singleResult(value), u.ctx, sf);
            }
            default: {
              throw new LuaRuntimeError(
                `Unknown unary operator ${u.operator}`,
                sf.withCtx(u.ctx),
              );
            }
          }
        };

        return rpThen(value, applyUnary);
      }
      case "QueryIn": {
        const leftVal = evalExpression(e.left, env, sf);
        const rightVal = evalExpression(e.right, env, sf);

        const applyIn = (left: LuaValue, right: LuaValue): LuaValue => {
          const leftSingle = singleResult(left);
          const rightSingle = singleResult(right);

          if (rightSingle instanceof LuaTable) {
            for (let i = 1; i <= rightSingle.length; i++) {
              const candidate = rightSingle.rawGet(i);
              if (candidate === leftSingle) {
                return true;
              }
            }

            for (const key of luaKeys(rightSingle)) {
              if (typeof key === "number" && Number.isInteger(key)) {
                continue;
              }
              const candidate = rightSingle.rawGet(key);
              if (candidate === leftSingle) {
                return true;
              }
            }

            return false;
          }

          if (Array.isArray(rightSingle)) {
            return rightSingle.some((candidate) => candidate === leftSingle);
          }

          throw new LuaRuntimeError(
            "'in' requires a table or array on the right side",
            sf.withCtx(e.ctx),
          );
        };

        if (!isPromise(leftVal) && !isPromise(rightVal)) {
          return applyIn(leftVal, rightVal);
        }

        if (isPromise(leftVal) && !isPromise(rightVal)) {
          return (leftVal as Promise<LuaValue>).then((lv) =>
            applyIn(lv, rightVal),
          );
        }

        if (!isPromise(leftVal) && isPromise(rightVal)) {
          return (rightVal as Promise<LuaValue>).then((rv) =>
            applyIn(leftVal, rv),
          );
        }

        return (leftVal as Promise<LuaValue>).then((lv) =>
          (rightVal as Promise<LuaValue>).then((rv) => applyIn(lv, rv)),
        );
      }
      case "Variable":
      case "FunctionCall":
      case "TableAccess":
      case "PropertyAccess": {
        return evalPrefixExpression(e, env, sf);
      }
      case "TableConstructor": {
        const tc = asTableConstructor(e);
        const table = new LuaTable();
        let nextArrayIndex = 1;

        const processField = (
          fieldIdx: number,
        ): LuaTable | Promise<LuaTable> => {
          for (let fi = fieldIdx; fi < tc.fields.length; fi++) {
            const field = tc.fields[fi];
            switch (field.type) {
              case "PropField": {
                const value = evalExpression(field.value, env, sf);
                if (isPromise(value)) {
                  return (value as Promise<any>).then((v) => {
                    void table.set(field.key, singleResult(v), sf);
                    return processField(fi + 1);
                  });
                }
                void table.set(field.key, singleResult(value), sf);
                break;
              }
              case "DynamicField": {
                const key = evalExpression(field.key, env, sf);
                const val = evalExpression(field.value, env, sf);
                if (isPromise(key) || isPromise(val)) {
                  return rpThen(key, (k) =>
                    rpThen(val, (v) => {
                      void table.set(singleResult(k), singleResult(v), sf);
                      return processField(fi + 1);
                    }),
                  ) as Promise<LuaTable>;
                }
                void table.set(singleResult(key), singleResult(val), sf);
                break;
              }
              case "ExpressionField": {
                const value = evalExpression(field.value, env, sf);
                if (isPromise(value)) {
                  return (value as Promise<any>).then((v) => {
                    if (v instanceof LuaMultiRes) {
                      const flat = v.flatten();
                      for (let j = 0; j < flat.values.length; j++) {
                        table.rawSetArrayIndex(nextArrayIndex, flat.values[j]);
                        nextArrayIndex++;
                      }
                    } else {
                      table.rawSetArrayIndex(nextArrayIndex, singleResult(v));
                      nextArrayIndex++;
                    }
                    return processField(fi + 1);
                  });
                }
                if (value instanceof LuaMultiRes) {
                  const flat = value.flatten();
                  for (let j = 0; j < flat.values.length; j++) {
                    table.rawSetArrayIndex(nextArrayIndex, flat.values[j]);
                    nextArrayIndex++;
                  }
                } else {
                  table.rawSetArrayIndex(nextArrayIndex, singleResult(value));
                  nextArrayIndex++;
                }
                break;
              }
            }
          }
          return table;
        };

        return processField(0);
      }
      case "FunctionDefinition": {
        const fd = asFunctionDef(e);
        return new LuaFunction(fd.body, env);
      }
      case "Query": {
        const q = asQueryExpr(e);
        const findFromClause = q.clauses.find((c) => c.type === "From");
        if (!findFromClause) {
          throw new LuaRuntimeError(
            "query has no 'from' clause",
            sf.withCtx(q.ctx),
          );
        }
        const fromSource = fromFieldsToSource(
          findFromClause.fields,
          findFromClause.ctx,
        );
        const explainClause = q.clauses.find((c) => c.type === "Explain");
        const explainOpts: ExplainOptions | undefined = explainClause
          ? {
              analyze: explainClause.analyze,
              costs: explainClause.costs,
              summary: explainClause.summary,
              timing: explainClause.timing,
              verbose: explainClause.verbose,
              hints: explainClause.hints,
            }
          : undefined;

        if (fromSource.kind === "cross") {
          return (async () => {
            const planT0 = performance.now();

            const planClause = q.clauses.find((c) => c.type === "Leading") as
              | LuaLeadingClause
              | undefined;
            const planOrder = planClause?.fields.map((f) => {
              if (f.type === "ExpressionField" && f.value.type === "Variable") {
                return f.value.name;
              }
              throw new LuaRuntimeError(
                "each entry in 'leading' clause must be a relation name",
                sf.withCtx(planClause!.ctx),
              );
            });

            const materializedOverrides = new Map<string, any[]>();

            for (const src of fromSource.sources) {
              const val = await evalExpression(src.expression, env, sf);

              if (src.materialized) {
                const items = await materializeValueAsItems(val, env, sf);
                materializedOverrides.set(src.name, items);
                // Materialised array source: no pushdown, no overlay.
                // Uses the canonical ArrayScanEngine spec so EXPLAIN and
                // the engine implementation share one source of truth.
                src.stats = {
                  ...computeStatsFromArray(items),
                  statsSource: "recomputed-materialized-exact",
                  executionCapabilities: {
                    engines: [ARRAY_SCAN_ENGINE_CAPABILITY],
                  },
                };
                continue;
              }

              if (
                val &&
                typeof val === "object" &&
                val.getStats &&
                typeof val.getStats === "function"
              ) {
                const stats = await val.getStats();
                if (stats) {
                  src.stats = normalizeProvidedStats(stats);
                }
              } else if (Array.isArray(val)) {
                src.stats = computeStatsFromArray(val);
              } else if (val instanceof LuaTable) {
                src.stats = computeStatsFromArray(luaTableToArray(val));
              }
            }

            const whereClause = q.clauses.find((c) => c.type === "Where");

	    // Fold trivial true conjuncts (e.g. literal `true`, `not
	    // false`, `not nil`) out of the WHERE before any pushdown
	    // classification or join-predicate extraction runs to not
	    // inflate plan complexity.
            const { expr: prunedWhereExpr, pruned: prunedWhereConjuncts } =
              pruneAlwaysTrueConjuncts(whereClause?.expression);

            const sourceNames = new Set(fromSource.sources.map((s) => s.name));
            const equiPreds = extractEquiPredicates(
              prunedWhereExpr,
              sourceNames,
            );

            const rangePreds = extractRangePredicates(
              prunedWhereExpr,
              sourceNames,
            );

            const { pushed: pushedFilters, residual: pushdownResidualWhere } =
              extractSingleSourceFilters(prunedWhereExpr, sourceNames);

            const transitiveFilters = generateTransitivePredicates(
              pushedFilters,
              equiPreds,
              sourceNames,
            );
            if (transitiveFilters.length > 0) {
              pushedFilters.push(...transitiveFilters);
            }

            const pushedFilterExprBySource = new Map<string, string>();
            for (const src of fromSource.sources) {
              const srcFilters = pushedFilters.filter(
                (f) => f.sourceName === src.name,
              );
              if (srcFilters.length === 0) continue;

              const combined =
                srcFilters.length === 1
                  ? exprToDisplayString(srcFilters[0].expression)
                  : srcFilters
                      .map((f) => `(${exprToString(f.expression)})`)
                      .join(" and ");

              pushedFilterExprBySource.set(src.name, combined);
            }

            const normalizationInfoBySource: Map<
              string,
              SourceNormalizationInfo
            > = buildNormalizationInfoBySource(prunedWhereExpr, sourceNames);

            for (const src of fromSource.sources) {
              const srcFilters = pushedFilters.filter(
                (f) => f.sourceName === src.name,
              );
              if (srcFilters.length === 0) {
                continue;
              }

              const val = await evalExpression(src.expression, env, sf);

              const canDelegate =
                collectionSupportsPredicateDelegation(src.stats) &&
                val &&
                typeof val === "object" &&
                "query" in val &&
                typeof (val as any).query === "function";

              const dispatchReports: EngineDispatchReport[] = [];

              let filtered: any[];
              let pushdownNarrowing: PushdownNarrowingReport | undefined;

              // Pre-pass wall-clock window (DONT move around!)
              let prepassStartedAtMs: number | undefined;
              let prepassFinishedAtMs: number | undefined;

              if (canDelegate) {
                const combinedWhere: LuaExpression =
                  srcFilters.length === 1
                    ? srcFilters[0].expression
                    : srcFilters.slice(1).reduce<LuaExpression>(
                        (acc, f) => ({
                          type: "Binary" as const,
                          operator: "and" as const,
                          left: acc,
                          right: f.expression,
                          ctx: f.expression.ctx,
                        }),
                        srcFilters[0].expression,
                      );

                const engineCaptureInstrumentation: QueryInstrumentation = {
                  onEngineDispatch(reports) {
                    dispatchReports.push(...reports);
                  },
                  onPushdownNarrowed(info) {
                    pushdownNarrowing = info;
                  },
                };

                prepassStartedAtMs = performance.now();
                filtered = await (val as any).query(
                  { where: combinedWhere, objectVariable: src.name },
                  env,
                  sf,
                  globalThis.client?.config,
                  engineCaptureInstrumentation,
                );
                prepassFinishedAtMs = performance.now();
              } else {
                const items = await materializeValueAsItems(val, env, sf);
                prepassStartedAtMs = performance.now();
                filtered = await applyPushedFilters(
                  items,
                  src.name,
                  srcFilters,
                  env,
                  sf,
                );
                prepassFinishedAtMs = performance.now();
              }

              const originalRowCount = src.stats?.rowCount;
              const originalNdv = src.stats?.ndv;
              const originalMcv = src.stats?.mcv;
              const filteredStats = computeStatsFromArray(filtered);

              const filteredRowCount = filteredStats.rowCount;
              let finalNdv = filteredStats.ndv;
              let finalMcv = filteredStats.mcv;

              if (originalNdv && originalNdv.size > 0) {
                finalNdv = new Map<string, number>();
                for (const [col, ndv] of originalNdv) {
                  finalNdv.set(col, Math.min(ndv, filteredRowCount));
                }
              }

              if (originalMcv && originalMcv.size > 0) {
                finalMcv = originalMcv;
              }

              // Derive the post-filter engine list from the dispatcher's
              // run reports. Real engine ids survive into EXPLAIN.
              const originalEngines: QueryEngineCapability[] =
                src.stats?.executionCapabilities?.engines ?? [];
              const originalAugmenterEngines = originalEngines.filter((e) =>
                e.id.startsWith("augmenter-overlay-"),
              );
              const originalVirtualColumns = src.stats?.virtualColumns;
              const postFilterEngines: QueryEngineCapability[] = (() => {
                if (canDelegate && dispatchReports.length > 0) {
                  const byId = new Map(originalEngines.map((e) => [e.id, e]));
                  const engines: QueryEngineCapability[] = [];
                  const seen = new Set<string>();
                  for (const r of dispatchReports) {
                    if (seen.has(r.engineId)) continue;
                    seen.add(r.engineId);
                    const orig = byId.get(r.engineId);
                    const base: QueryEngineCapability = orig ?? {
                      id: r.engineId,
                      name: r.engineName,
                      kind: r.engineKind,
                      capabilities: [],
                      baseCostWeight: r.baseCostWeight,
                      priority: r.priority,
                    };
                    engines.push({
                      ...base,
                      runtimeStats: r.runtimeStats,
                      executeMs: r.executeMs,
                    });
                  }
                  return engines;
                }

                if (canDelegate) {
                  return [
                    {
                      id: "delegated-filter",
                      name: "Delegated filtered source",
                      kind: "index",
                      capabilities: [
                        "scan-bitmap",
                        "stage-where",
                        "stats-row-count",
                        ...(collectionHasPlannerCapability(src.stats, "pred-eq")
                          ? (["pred-eq"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "pred-neq",
                        )
                          ? (["pred-neq"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(src.stats, "pred-lt")
                          ? (["pred-lt"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "pred-lte",
                        )
                          ? (["pred-lte"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(src.stats, "pred-gt")
                          ? (["pred-gt"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "pred-gte",
                        )
                          ? (["pred-gte"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(src.stats, "pred-in")
                          ? (["pred-in"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "bool-and",
                        )
                          ? (["bool-and"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(src.stats, "bool-or")
                          ? (["bool-or"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "bool-not",
                        )
                          ? (["bool-not"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "expr-literal",
                        )
                          ? (["expr-literal"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "expr-column-qualified",
                        )
                          ? (["expr-column-qualified"] as const)
                          : []),
                        ...(collectionHasPlannerCapability(
                          src.stats,
                          "expr-column-unqualified",
                        )
                          ? (["expr-column-unqualified"] as const)
                          : []),
                      ],
                      baseCostWeight: 0.6,
                      priority: 20,
                    },
                    ...originalAugmenterEngines,
                  ];
                }

                // Materialised path
                return [
                  COMPUTE_FALLBACK_ENGINE_CAPABILITY,
                  ...originalAugmenterEngines,
                ];
              })();

              src.stats = {
                ...filteredStats,
                ndv: finalNdv,
                mcv: finalMcv,
                unfilteredRowCount: originalRowCount,
                pushdownNarrowedRowCount: pushdownNarrowing?.narrowedRowCount,
                prepassStartedAtMs,
                prepassFinishedAtMs,
                statsSource: "recomputed-filtered-exact",
                virtualColumns: originalVirtualColumns,
                executionCapabilities: { engines: postFilterEngines },
              };

              materializedOverrides.set(src.name, filtered);
            }

            const plannerConfig: JoinPlannerConfig | undefined = globalThis
              .client?.config
              ? {
                  watchdogLimit: globalThis.client.config.get(
                    "joinWatchdogLimit",
                    undefined,
                  ),
                  yieldChunk: globalThis.client.config.get(
                    "joinYieldChunk",
                    undefined,
                  ),
                  smallTableThreshold: globalThis.client.config.get(
                    "joinSmallTableThreshold",
                    undefined,
                  ),
                  mergeJoinThreshold: globalThis.client.config.get(
                    "joinMergeThreshold",
                    undefined,
                  ),
                  widthWeight: globalThis.client.config.get(
                    "joinWidthWeight",
                    undefined,
                  ),
                  candidateWidthWeight: globalThis.client.config.get(
                    "joinCandidateWidthWeight",
                    undefined,
                  ),
                }
              : undefined;

            const joinTree = buildJoinTree(
              fromSource.sources,
              planOrder,
              equiPreds,
              rangePreds,
              pushdownResidualWhere,
              plannerConfig,
            );

            const residualWhere = stripUsedJoinPredicates(
              pushdownResidualWhere,
              joinTree,
            );

            const selectClauseForValidation = q.clauses.find(
              (c) => c.type === "Select",
            );
            const orderByClauseForValidation = q.clauses.find(
              (c) => c.type === "OrderBy",
            );
            const groupByClauseForValidation = q.clauses.find(
              (c) => c.type === "GroupBy",
            );
            const havingClauseForValidation = q.clauses.find(
              (c) => c.type === "Having",
            );

            validatePostJoinSourceReferences(
              joinTree,
              {
                where: residualWhere,
                groupBy:
                  groupByClauseForValidation?.fields.flatMap((f) => {
                    // Wildcards are validated by the group-by evaluator.
                    if (
                      f.type === "StarField" ||
                      f.type === "StarSourceField" ||
                      f.type === "StarColumnField"
                    ) {
                      return [];
                    }
                    if (f.type === "PropField") {
                      return [{ expr: f.value, alias: f.key }];
                    }
                    return [{ expr: f.value }];
                  }) ?? undefined,
                having: havingClauseForValidation?.expression,
                select: selectClauseForValidation
                  ? fieldsToExpression(
                      selectClauseForValidation.fields,
                      selectClauseForValidation.ctx,
                      fromSource.sources.map((s) => s.name),
                    )
                  : undefined,
                orderBy:
                  orderByClauseForValidation?.orderBy.map((o) => ({
                    expr: o.expression,
                    desc: o.direction === "desc",
                    nulls: o.nulls,
                    using: o.using,
                    ctx: o.ctx,
                  })) ?? undefined,
              },
              sf,
            );

            let explainPlan: ExplainNode | undefined;
            if (explainOpts) {
              const explainQuery = await buildQueryFromClauses(q, env, sf, {
                where: residualWhere,
              });
              const explainSourceStats = new Map<string, CollectionStats>(
                fromSource.sources
                  .filter(
                    (s): s is JoinSource & { stats: CollectionStats } =>
                      s.stats !== undefined,
                  )
                  .map((s) => [s.name, s.stats]),
              );
              const joinRootNdv =
                joinTree.kind === "join" ? joinTree.estimatedNdv : undefined;
              explainPlan = wrapPlanWithQueryOps(
                explainJoinTree(
                  joinTree,
                  explainOpts,
                  pushedFilterExprBySource,
                  normalizationInfoBySource,
                ),
                {
                  ...explainQuery,
                  leading: planOrder,
                },
                explainSourceStats,
                joinRootNdv,
                plannerConfig,
                globalThis.client?.config,
              );
            }

            const planEndT = performance.now();

            const originalSourceOrder = fromSource.sources.map((s) => s.name);

            if (explainOpts && !explainOpts.analyze) {
              const result: ExplainResult = {
                plan: explainPlan!,
                planningTimeMs: Math.round((planEndT - planT0) * 1000) / 1000,
                leadingHint: buildLeadingHintInfo(
                  planOrder,
                  originalSourceOrder,
                  explainPlan!,
                ),
                prunedPredicates:
                  prunedWhereConjuncts.length > 0
                    ? formatPrunedConjuncts(prunedWhereConjuncts)
                    : undefined,
              };
              return formatExplainOutput(result, explainOpts);
            }

            if (explainOpts?.analyze) {
              const execT0 = performance.now();
              const joinPlan = unwrapToJoinPlan(explainPlan!);
              const joinRows = await executeAndInstrument(
                joinTree,
                joinPlan,
                env,
                sf,
                explainOpts,
                plannerConfig,
                materializedOverrides,
                execT0,
              );

              const joinedCollection = toCollection(joinRows);

              const analyzeQuery = await buildQueryFromClauses(q, env, sf, {
                where: residualWhere,
              });
              analyzeQuery.objectVariable = undefined;
              // Mirror the non-analyze cross-join path: wildcard expansion
              // (`select t.*`, `select *`, `select *.col`, etc.) needs to
              // resolve `t`/`p` against the joined sources!
              analyzeQuery.sourceNames = fromSource.sources.map((s) => s.name);

              const stageStats: QueryStageStat[] = [];
              const instrumentation: QueryInstrumentation = {
                onStage: (stat) => {
                  stageStats.push(stat);
                },
              };
              const aggregateInstrumentation: AggregateRuntimeInstrumentation =
                {
                  stats: {
                    rowsRemovedByAggregateFilter: 0,
                  },
                };

              const finalRows = await (joinedCollection as any).query(
                analyzeQuery,
                env,
                sf,
                globalThis.client?.config,
                instrumentation,
                aggregateInstrumentation,
              );

              explainPlan!.actualRows = finalRows.length;
              explainPlan!.actualLoops = 1;

              annotateExplainWrappersFromStageStats(
                explainPlan!,
                stageStats,
                execT0,
                explainOpts,
              );

              attachAnalyzeQueryOpStats(
                explainPlan!,
                aggregateInstrumentation.stats,
              );

              const execEndT = performance.now();
              const result: ExplainResult = {
                plan: explainPlan!,
                planningTimeMs: Math.round((planEndT - planT0) * 1000) / 1000,
                executionTimeMs: Math.round((execEndT - execT0) * 1000) / 1000,
                leadingHint: buildLeadingHintInfo(
                  planOrder,
                  originalSourceOrder,
                  explainPlan!,
                ),
                resultColumns: computeResultColumns(finalRows),
                prunedPredicates:
                  prunedWhereConjuncts.length > 0
                    ? formatPrunedConjuncts(prunedWhereConjuncts)
                    : undefined,
              };
              return formatExplainOutput(result, explainOpts);
            }

            const result = await executeJoinTree(
              joinTree,
              env,
              sf,
              plannerConfig,
              materializedOverrides,
            );

            const joinedCollection = toCollection(result);

            const query = await buildQueryFromClauses(q, env, sf, {
              where: residualWhere,
            });
            query.objectVariable = undefined;
            query.sourceNames = fromSource.sources.map((s) => s.name);

            return joinedCollection
              .query(query, env, sf, globalThis.client?.config)
              .then(jsToLuaValue);
          })();
        }

        // Single-source
        const {
          objectVariable,
          expression: objectExpression,
          materialized: forceMaterialized,
        } = fromSource;
        const sourceEvalT0 = performance.now();
        return Promise.resolve(evalExpression(objectExpression, env, sf)).then(
          async (collection: LuaValue) => {
            const sourceEvalElapsedMs = performance.now() - sourceEvalT0;
            const planT0 = performance.now();

            if (!collection) {
              throw new LuaRuntimeError(
                "'from' clause source evaluated to null",
                sf.withCtx(q.ctx),
              );
            }

            if (forceMaterialized) {
              const items = await materializeValueAsItems(collection, env, sf);
              collection = toCollection(items);
            } else if (
              typeof collection === "object" &&
              collection !== null &&
              "query" in collection &&
              typeof (collection as any).query === "function"
            ) {
            } else if (collection instanceof LuaTable && collection.empty()) {
              collection = toCollection([]);
            } else if (collection instanceof LuaTable) {
              if (collection.length > 0) {
                const arr: any[] = [];
                for (let i = 1; i <= collection.length; i++) {
                  arr.push(collection.rawGet(i));
                }
                collection = toCollection(arr);
              } else {
                collection = toCollection([collection]);
              }
            } else {
              collection = toCollection(luaValueToJS(collection, sf));
            }

            const query = await buildQueryFromClauses(q, env, sf);
            query.objectVariable = objectVariable;
            query.sourceNames = objectVariable ? [objectVariable] : [];
            const { expr: prunedSingleWhere, pruned: prunedWhereConjuncts } =
              pruneAlwaysTrueConjuncts(query.where);
            query.where = prunedSingleWhere;
            const stats = await getStatsForValue(collection, env, sf);
            const sourceName = objectVariable ?? "_";
            const singleSourceNames = new Set([sourceName]);
            const normalizationInfoBySource = buildNormalizationInfoBySource(
              query.where,
              singleSourceNames,
            );
            const pushedFilterExprBySource = new Map<string, string>();
            const normalizationInfo = normalizationInfoBySource.get(sourceName);
            if (
              normalizationInfo &&
              normalizationInfo.pushdownExpr !== "none"
            ) {
              pushedFilterExprBySource.set(
                sourceName,
                normalizationInfo.pushdownExpr,
              );
            }

            let explainPlan: ExplainNode | undefined;
            if (explainOpts) {
              const explainQuery = await buildQueryFromClauses(q, env, sf, {
                where: query.where,
              });
              const explainSourceStats = new Map<string, CollectionStats>([
                [sourceName, stats],
              ]);
              explainPlan = wrapPlanWithQueryOps(
                explainSingleSource(
                  sourceName,
                  objectExpression,
                  stats,
                  fromSource.withHints,
                  fromSource.materialized,
                  pushedFilterExprBySource.get(sourceName),
                  normalizationInfo,
                ),
                explainQuery,
                explainSourceStats,
                undefined,
                undefined,
                globalThis.client?.config,
              );
            }

            const planEndT = performance.now();

            if (explainOpts && !explainOpts.analyze) {
              const result: ExplainResult = {
                plan: explainPlan!,
                planningTimeMs: Math.round((planEndT - planT0) * 1000) / 1000,
                prunedPredicates:
                  prunedWhereConjuncts.length > 0
                    ? formatPrunedConjuncts(prunedWhereConjuncts)
                    : undefined,
              };
              return formatExplainOutput(result, explainOpts);
            }

            if (explainOpts?.analyze) {
              const execT0 = sourceEvalT0;
              void sourceEvalElapsedMs;
              const stageStats: QueryStageStat[] = [];
              const instrumentation: QueryInstrumentation = {
                onStage: (stat) => {
                  stageStats.push(stat);
                },
              };

              const aggregateInstrumentation: AggregateRuntimeInstrumentation =
                {
                  stats: {
                    rowsRemovedByAggregateFilter: 0,
                  },
                };

              const finalRows = await (collection as any).query(
                query,
                env,
                sf,
                globalThis.client?.config,
                instrumentation,
                aggregateInstrumentation,
              );

              annotateExplainWrappersFromStageStats(
                explainPlan!,
                stageStats,
                execT0,
                explainOpts,
              );

              const scanPlan = unwrapToJoinPlan(explainPlan!);
              scanPlan.actualRows = stats.rowCount;
              scanPlan.actualLoops = 1;
              if (explainOpts.timing) {
                const scanEndMs =
                  stageStats.length > 0
                    ? stageStats[0].startTimeMs
                    : performance.now();
                const total = Math.round((scanEndMs - execT0) * 1000) / 1000;
                scanPlan.actualStartupTimeMs = 0;
                scanPlan.actualTimeMs = total;
              }

              explainPlan!.actualRows = finalRows.length;
              explainPlan!.actualLoops = 1;

              attachAnalyzeQueryOpStats(
                explainPlan!,
                aggregateInstrumentation.stats,
              );

              const execEndT = performance.now();
              const result: ExplainResult = {
                plan: explainPlan!,
                planningTimeMs: Math.round((planEndT - planT0) * 1000) / 1000,
                executionTimeMs: Math.round((execEndT - execT0) * 1000) / 1000,
                resultColumns: computeResultColumns(finalRows),
                prunedPredicates:
                  prunedWhereConjuncts.length > 0
                    ? formatPrunedConjuncts(prunedWhereConjuncts)
                    : undefined,
              };
              return formatExplainOutput(result, explainOpts);
            }

            return (collection as any)
              .query(query, env, sf, globalThis.client?.config)
              .then(jsToLuaValue);
          },
        );
      }
      default:
        throw new LuaRuntimeError(
          `Unknown expression type ${e.type}`,
          sf.withCtx(e.ctx),
        );
    }
  } catch (err: any) {
    // Repackage any non Lua-specific exceptions with some position information
    if (!err.constructor.name.startsWith("Lua")) {
      throw new LuaRuntimeError(err.message, sf.withCtx(e.ctx), err);
    } else {
      throw err;
    }
  }
}

function evalPrefixExpression(
  e: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue> | LuaValue {
  switch (e.type) {
    case "Variable": {
      const v = asVariable(e);
      const value = env.get(v.name);
      if (value === undefined) {
        return null;
      }
      return value;
    }

    case "Parenthesized": {
      const p = asParenthesized(e);
      return evalExpression(p.expression, env, sf);
    }

    // <<expr>>[<<expr>>]
    case "TableAccess": {
      const ta = asTableAccess(e);
      // Sync-first: evaluate object and key without allocating Promise when both are sync.
      const objV = evalPrefixExpression(ta.object, env, sf);
      const keyV = evalExpression(ta.key, env, sf);

      if (!isPromise(objV) && !isPromise(keyV)) {
        const table = singleResult(objV);
        const key = singleResult(keyV);
        return luaGet(table, key, ta.ctx, sf);
      }

      return rpThen(objV, (obj) =>
        rpThen(keyV, (key) =>
          luaGet(singleResult(obj), singleResult(key), ta.ctx, sf),
        ),
      );
    }

    // <expr>.property
    case "PropertyAccess": {
      const pa = asPropertyAccess(e);
      // Sync-first: evaluate object; avoid Promise when object is sync.
      const objV = evalPrefixExpression(pa.object, env, sf);
      if (!isPromise(objV)) {
        return luaGet(singleResult(objV), pa.property, pa.ctx, sf);
      }
      return rpThen(objV, (obj) =>
        luaGet(singleResult(obj), pa.property, pa.ctx, sf),
      );
    }

    case "FunctionCall": {
      const fc = asFunctionCall(e);

      if (fc.orderBy && fc.orderBy.length > 0) {
        throw new LuaRuntimeError(
          `'order by' specified, but ${functionNameForSqlError(fc)} is not an aggregate function`,
          sf.withCtx(fc.ctx),
        );
      }

      if (fc.wildcardArg) {
        const fn = functionNameForSqlError(fc);
        const starArg =
          fc.wildcardArg.kind === "all" ? "*" : `${fc.wildcardArg.source}.*`;
        throw new LuaRuntimeError(
          `${fn}(${starArg}) specified, but ${fn} is not an aggregate function`,
          sf.withCtx(fc.ctx),
        );
      }

      const prefixValue = evalPrefixExpression(fc.prefix, env, sf);
      if (prefixValue === null || prefixValue === undefined) {
        const nilMsg =
          fc.prefix.type === "Variable"
            ? `attempt to call a nil value (global '${
                asVariable(fc.prefix).name
              }')`
            : `attempt to call a nil value`;
        throw new LuaRuntimeError(nilMsg, sf.withCtx(fc.prefix.ctx));
      }

      // Fast path: non-method call with sync prefix
      if (!fc.name && !isPromise(prefixValue)) {
        const argsVal = evalExpressions(fc.args, env, sf);
        if (!isPromise(argsVal)) {
          return luaCall(prefixValue, argsVal as LuaValue[], fc.ctx, sf);
        }
        return (argsVal as Promise<LuaValue[]>).then((args) =>
          luaCall(prefixValue, args, fc.ctx, sf),
        );
      }

      const handleFunctionCall = (
        calleeVal: LuaValue,
        selfArgs: LuaValue[],
      ): LuaValue | Promise<LuaValue> => {
        // Normal argument handling for hello:there(a, b, c) type calls
        if (fc.name) {
          const self = calleeVal;
          calleeVal = luaIndexValue(calleeVal, fc.name, sf);

          if (isPromise(calleeVal)) {
            return (calleeVal as Promise<any>).then((cv) =>
              handleFunctionCall(cv, [self]),
            );
          }
          selfArgs = [self];
        }

        const argsVal = evalExpressions(fc.args, env, sf);
        if (!isPromise(argsVal)) {
          const allArgs =
            selfArgs.length > 0
              ? [...selfArgs, ...(argsVal as LuaValue[])]
              : (argsVal as LuaValue[]);
          return luaCall(calleeVal, allArgs, fc.ctx, sf);
        }
        return (argsVal as Promise<LuaValue[]>).then((args) =>
          luaCall(
            calleeVal,
            selfArgs.length > 0 ? [...selfArgs, ...args] : args,
            fc.ctx,
            sf,
          ),
        );
      };

      if (isPromise(prefixValue)) {
        return (prefixValue as Promise<any>).then((pv) =>
          handleFunctionCall(pv, []),
        );
      }
      return handleFunctionCall(prefixValue, []);
    }

    default: {
      throw new LuaRuntimeError(
        `Unknown prefix expression type ${e.type}`,
        sf.withCtx(e.ctx),
      );
    }
  }
}

// Helper functions to reduce duplication
function evalMetamethod(
  left: any,
  right: any,
  metaMethod: string,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaValue | undefined {
  const leftMetatable = getMetatable(left, sf);
  if (leftMetatable) {
    const fn = leftMetatable.rawGet(metaMethod);
    if (!(fn === undefined || fn === null)) {
      return luaCall(fn, [left, right], ctx, sf);
    }
  }

  const rightMetatable = getMetatable(right, sf);
  if (rightMetatable) {
    const fn = rightMetatable.rawGet(metaMethod);
    if (!(fn === undefined || fn === null)) {
      return luaCall(fn, [left, right], ctx, sf);
    }
  }
}

// Unary metamethod lookup and call
function evalUnaryMetamethod(
  value: any,
  metaMethod: "__unm" | "__bnot",
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaValue | Promise<LuaValue> | undefined {
  const mt = getMetatable(value, sf);
  if (!mt) {
    return undefined;
  }
  const fn = mt.rawGet(metaMethod);
  if (fn === undefined || fn === null) {
    return undefined;
  }
  return luaCall(fn, [value], ctx, sf);
}

// Unary metamethod handling (with fallback)
function unaryWithMeta(
  arg: any,
  meta: "__unm" | "__bnot",
  ctx: ASTCtx,
  sf: LuaStackFrame,
  fallback: () => any,
): any {
  const mm = evalUnaryMetamethod(arg, meta, ctx, sf);

  if (mm !== undefined) {
    return isPromise(mm)
      ? (mm as Promise<any>).then(singleResult)
      : singleResult(mm);
  }
  return fallback();
}

// Logical short-circuit evaluation
function evalLogical(
  op: "and" | "or",
  leftExpr: LuaExpression,
  rightExpr: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
): any {
  const left = evalExpression(leftExpr, env, sf);

  const decide = (lv: any) => {
    if (op === "or") {
      if (luaTruthy(lv)) {
        return singleResult(lv);
      }
      const rv = evalExpression(rightExpr, env, sf);
      return isPromise(rv)
        ? (rv as Promise<any>).then(singleResult)
        : singleResult(rv);
    }
    if (!luaTruthy(lv)) {
      return singleResult(lv);
    }
    const rv = evalExpression(rightExpr, env, sf);
    return isPromise(rv)
      ? (rv as Promise<any>).then(singleResult)
      : singleResult(rv);
  };

  if (isPromise(left)) {
    return (left as Promise<any>).then(decide);
  }
  return decide(left);
}

type TypedValue = { value: LuaValue };

function evalExprWithNumericType(
  expr: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
  _wantNumericType: boolean,
): TypedValue | Promise<TypedValue> {
  const v = evalExpression(expr, env, sf);
  const apply = (vv: any): TypedValue => ({ value: vv });
  return rpThen(v, apply) as any;
}

function getSimpleLiteralType(expr: LuaExpression): NumericType | undefined {
  if (expr.type === "Number") {
    return expr.numericType === "int" ? "int" : "float";
  }
  if (
    expr.type === "Unary" &&
    (expr.operator === "+" || expr.operator === "-") &&
    expr.argument.type === "Number"
  ) {
    return expr.argument.numericType === "int" ? "int" : "float";
  }
  return undefined;
}

function evalBinaryWithLR(
  op: string,
  leftExpr: LuaExpression,
  rightExpr: LuaExpression,
  ctx: ASTCtx,
  env: LuaEnv,
  sf: LuaStackFrame,
): any {
  const wantNumericType = isNumericBinaryOp(op);
  const leftType = wantNumericType ? getSimpleLiteralType(leftExpr) : undefined;
  const rightType = wantNumericType
    ? getSimpleLiteralType(rightExpr)
    : undefined;
  const leftVal = evalExpression(leftExpr, env, sf);

  // Sync-first fast path: avoid closure allocation when both operands are sync
  if (!isPromise(leftVal)) {
    const rightVal = evalExpression(rightExpr, env, sf);
    if (!isPromise(rightVal)) {
      return luaOp(
        op,
        singleResult(leftVal),
        singleResult(rightVal),
        leftType,
        rightType,
        ctx,
        sf,
      );
    }
    return (rightVal as Promise<any>).then((rv) =>
      luaOp(
        op,
        singleResult(leftVal),
        singleResult(rv),
        leftType,
        rightType,
        ctx,
        sf,
      ),
    );
  }

  return (leftVal as Promise<any>).then((lv) => {
    const rightVal = evalExpression(rightExpr, env, sf);
    if (!isPromise(rightVal)) {
      return luaOp(
        op,
        singleResult(lv),
        singleResult(rightVal),
        leftType,
        rightType,
        ctx,
        sf,
      );
    }
    return (rightVal as Promise<any>).then((rv) =>
      luaOp(
        op,
        singleResult(lv),
        singleResult(rv),
        leftType,
        rightType,
        ctx,
        sf,
      ),
    );
  });
}

function createBitwiseError(
  val: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaRuntimeError {
  if (typeof val === "string") {
    return new LuaRuntimeError(
      `attempt to perform bitwise operation on a string value (constant '${val}')`,
      sf.withCtx(ctx),
    );
  }
  const t = luaTypeName(val);
  if (t === "number") {
    return new LuaRuntimeError(
      `number has no integer representation`,
      sf.withCtx(ctx),
    );
  }
  return new LuaRuntimeError(
    `attempt to perform bitwise operation on a ${t} value`,
    sf.withCtx(ctx),
  );
}

function getBinaryMM(
  a: any,
  b: any,
  mmName: string,
  sf: LuaStackFrame,
): any | null {
  // Look in a's metatable first; if absent, look in b's.
  const ma = getMetatable(a, sf);
  if (ma) {
    const mmA = ma.rawGet(mmName);
    if (!(mmA === undefined || mmA === null)) {
      return mmA;
    }
  }
  const mb = getMetatable(b, sf);
  if (mb) {
    const mmB = mb.rawGet(mmName);
    if (!(mmB === undefined || mmB === null)) {
      return mmB;
    }
  }
  return null;
}

function luaEqWithMetamethod(
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): boolean | Promise<boolean> {
  if (luaEquals(a, b)) {
    return true;
  }

  const ta = luaTypeName(a);
  const tb = luaTypeName(b);

  // __eq only applies to tables/userdata
  const aOk = ta === "table" || ta === "userdata";
  const bOk = tb === "table" || tb === "userdata";
  if (!aOk || !bOk) {
    return false;
  }

  const getEqMM = (obj: any): any | null => {
    const mt = getMetatable(obj, sf);
    if (!mt) return null;

    const mm = mt.rawGet("__eq");
    if (mm === undefined || mm === null) return null;

    if (typeof mm === "function" || isILuaFunction(mm)) {
      return mm;
    }

    const ty = luaTypeName(mm);
    throw new LuaRuntimeError(`attempt to call a ${ty} value`, sf.withCtx(ctx));
  };

  // Try left __eq first, then right.
  const mm = getEqMM(a) ?? getEqMM(b);
  if (!mm) {
    return false;
  }

  const r = luaCall(mm, [a, b], ctx, sf);
  return isPromise(r)
    ? (r as Promise<any>).then((v) => !!singleResult(v))
    : !!singleResult(r);
}

function luaRelWithMetamethod(
  op: "<" | "<=",
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): boolean | Promise<boolean> {
  const an = isTaggedFloat(a) ? a.value : a;
  const bn = isTaggedFloat(b) ? b.value : b;

  if (typeof an === "number" && typeof bn === "number") {
    return op === "<" ? an < bn : an <= bn;
  }
  if (typeof an === "string" && typeof bn === "string") {
    return op === "<" ? an < bn : an <= bn;
  }

  const mmName = op === "<" ? "__lt" : "__le";
  const mm = getBinaryMM(a, b, mmName, sf);
  if (mm) {
    const r = luaCall(mm, [a, b], ctx, sf);
    if (isPromise(r)) {
      return (r as Promise<any>).then((v) => !!singleResult(v));
    }
    return !!singleResult(r);
  }

  throw new LuaRuntimeError(
    `attempt to compare ${luaTypeName(a)} with ${luaTypeName(b)}`,
    sf.withCtx(ctx),
  );
}

/**
 * Length operator:
 * - for strings return byte length, ignore `__len`,
 * - for Lua tables if metatable has `__len` metamethod then call it;
 *   use table length otherwise,
 * - for other values (userdata): honor `__len` if present,
 * - for JavaScript arrays return length,
 * - throw error otherwise.
 */
function luaLengthOp(val: any, ctx: ASTCtx, sf: LuaStackFrame): LuaValue {
  // Strings: ignore `__len`
  if (typeof val === "string") {
    return val.length;
  }

  // Tables: prefer metatable `__len` to raw length
  if (val instanceof LuaTable) {
    const mt = getMetatable(val, sf);
    if (mt) {
      const fn = mt.rawGet("__len");
      if (!(fn === undefined || fn === null)) {
        return luaCall(fn, [val], ctx, sf);
      }
    }
    return val.length;
  }

  // Other values: allow metatable `__len` first
  {
    const mt = getMetatable(val, sf);
    if (mt) {
      const fn = mt.rawGet("__len");
      if (!(fn === undefined || fn === null)) {
        return luaCall(fn, [val], ctx, sf);
      }
    }
  }

  // JS arrays (interop): length if no `__len` override
  if (Array.isArray(val)) {
    return val.length;
  }

  // Otherwise error with type
  const t = luaTypeOf(val) as LuaType;
  throw new LuaRuntimeError(
    `attempt to get length of a ${t} value`,
    sf.withCtx(ctx),
  );
}

function evalExpressions(
  es: LuaExpression[],
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue[]> | LuaValue[] {
  const len = es.length;
  if (len === 0) return [];

  // Evaluate all arguments (sync-first); avoid .map() closure overhead
  const parts = new Array(len);
  for (let i = 0; i < len; i++) {
    parts[i] = evalExpression(es[i], env, sf);
  }
  const argsVal = rpAll(parts);

  // In Lua multi-returns propagate only in tail position of an expression list.
  const finalize = (argsResolved: any[]) => {
    const out: LuaValue[] = [];
    const lastIdx = argsResolved.length - 1;
    // All but last expression produce a single value
    for (let i = 0; i < lastIdx; i++) {
      out.push(singleResult(argsResolved[i]));
    }
    // Last expression preserves multiple results
    const last = argsResolved[lastIdx];
    if (last instanceof LuaMultiRes) {
      out.push(...last.flatten().values);
    } else {
      out.push(singleResult(last));
    }
    return out;
  };

  return rpThen(argsVal, finalize);
}

type EvalBlockResult =
  | undefined
  | ControlSignal
  | Promise<undefined | ControlSignal>;

function runStatementsNoGoto(
  stmts: LuaStatement[],
  execEnv: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn: boolean,
  startIdx: number,
): undefined | ControlSignal | Promise<undefined | ControlSignal> {
  const processFrom = (
    idx: number,
  ): undefined | ControlSignal | Promise<undefined | ControlSignal> => {
    for (let i = idx; i < stmts.length; i++) {
      const result = evalStatement(stmts[i], execEnv, sf, returnOnReturn);
      if (isPromise(result)) {
        return (result as Promise<any>).then((res) => {
          if (res !== undefined) {
            if (isGotoSignal(res)) {
              throw new LuaRuntimeError(
                "unexpected goto signal",
                sf.withCtx(stmts[i].ctx),
              );
            }
            return res;
          }
          return processFrom(i + 1);
        });
      }
      if (result !== undefined) {
        if (isGotoSignal(result)) {
          throw new LuaRuntimeError(
            "unexpected goto signal",
            sf.withCtx(stmts[i].ctx),
          );
        }
        return result;
      }
    }
    return;
  };

  return processFrom(startIdx);
}

function withCloseBoundary(
  sf: LuaStackFrame,
  mark: number,
  out: EvalBlockResult,
): EvalBlockResult {
  if (!isPromise(out)) {
    const r = luaCloseFromMark(sf, mark, null);
    if (isPromise(r)) {
      return (r as Promise<void>).then(() => out as any);
    }
    return out;
  }

  const p = out as Promise<any>;

  const onFulfilled = (res: any) => {
    const r = luaCloseFromMark(sf, mark, null);
    return isPromise(r) ? (r as Promise<void>).then(() => res) : res;
  };

  const onRejected = (e: any) => {
    const errObj: LuaValue =
      e instanceof LuaRuntimeError ? e.message : (e?.message ?? String(e));
    const r = luaCloseFromMark(sf, mark, errObj);
    if (isPromise(r)) {
      return (r as Promise<void>).then(() => {
        throw e;
      });
    }
    throw e;
  };

  return p.then(onFulfilled, onRejected);
}

function evalBlockNoClose(
  b: LuaBlock,
  env: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn: boolean,
): EvalBlockResult {
  const hasGotoFlag = b.hasGoto === true;
  const hasLabelFlag = b.hasLabel === true;
  const hasLabelHere = b.hasLabelHere === true;

  const curFn = sf.currentFunction;
  const fnHasGotos = curFn?.funcHasGotos;

  if (fnHasGotos === false || (!hasGotoFlag && !hasLabelFlag)) {
    const dup = b.dupLabelError;
    if (dup) {
      // Duplicated labels detected by parser.
      throw new LuaRuntimeError(
        `label '${dup.name}' already defined`,
        sf.withCtx(dup.ctx),
      );
    }

    const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
    return runStatementsNoGoto(b.statements, execEnv, sf, returnOnReturn, 0);
  }

  if (fnHasGotos === true && !hasLabelHere && !hasGotoFlag) {
    const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
    const stmts = b.statements;
    const runFrom = (i: number): EvalBlockResult => {
      for (; i < stmts.length; i++) {
        const r = evalStatement(stmts[i], execEnv, sf, returnOnReturn);
        if (isPromise(r)) {
          return (r as Promise<any>).then((res) => {
            if (isGotoSignal(res)) return res;
            if (res !== undefined) return res;
            return runFrom(i + 1);
          });
        }
        if (isGotoSignal(r)) return r;
        if (r !== undefined) return r;
      }
      return;
    };
    return runFrom(0);
  }

  let meta: ReturnType<typeof getBlockGotoMeta> | undefined;
  if (fnHasGotos === undefined && (hasGotoFlag || hasLabelFlag)) {
    meta = blockMetaOrThrow(b, sf);
    if (curFn) {
      curFn.funcHasGotos = !!meta?.funcHasGotos;
    }
  } else if (fnHasGotos === true) {
    meta = hasLabelFlag || hasGotoFlag ? blockMetaOrThrow(b, sf) : undefined;
  } else {
    meta = undefined;
  }

  if (!meta || !meta.funcHasGotos) {
    const dup = b.dupLabelError;
    if (dup) {
      throw new LuaRuntimeError(
        `label '${dup.name}' already defined`,
        sf.withCtx(dup.ctx),
      );
    }
    const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
    return runStatementsNoGoto(b.statements, execEnv, sf, returnOnReturn, 0);
  }

  const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
  const stmts = b.statements;

  const runFrom = (i: number): EvalBlockResult => {
    for (; i < stmts.length; i++) {
      const r = evalStatement(stmts[i], execEnv, sf, returnOnReturn);
      if (isPromise(r)) {
        return (r as Promise<any>).then((res) => {
          const consumed = consumeGotoInBlock(res, meta!.labels);
          if (typeof consumed === "number") {
            return runFrom(consumed);
          }
          if (consumed !== undefined) {
            return consumed;
          }
          return runFrom(i + 1);
        });
      }
      const consumed = consumeGotoInBlock(r, meta.labels);
      if (typeof consumed === "number") {
        i = consumed - 1;
        continue;
      }
      if (consumed !== undefined) {
        return consumed;
      }
    }
    return;
  };

  return runFrom(0);
}

/**
 * Evaluates a statement in two possible modes:
 *
 * 1. With `returnOnReturn` set to `true` will return the value of
 *    a return statement.
 * 2. With `returnOnReturn` set to `false` will throw a LuaReturn
 *    exception if a return statement is encountered.
 *
 * May also return `{ctrl:"goto", target}` for goto.
 */
export function evalStatement(
  s: LuaStatement,
  env: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn = false,
): undefined | ControlSignal | Promise<undefined | ControlSignal> {
  switch (s.type) {
    case "Assignment": {
      const a = asAssignment(s);
      const valuesRP = evalExpressions(a.expressions, env, sf);
      const lvaluesRP = evalPromiseValues(
        a.variables.map((lval) => evalLValue(lval, env, sf)),
      );

      const apply = (values: LuaValue[], lvalues: { env: any; key: any }[]) => {
        // Create the error-reporting frame once, not per-lvalue
        let errSf: LuaStackFrame | undefined;
        const ps: Promise<any>[] = [];
        for (let i = 0; i < lvalues.length; i++) {
          const r = luaSet(
            lvalues[i].env,
            lvalues[i].key,
            values[i],
            errSf || (errSf = sf.withCtx(a.ctx)),
          );

          if (isPromise(r)) {
            ps.push(r);
          }
        }
        if (ps.length) {
          return Promise.all(ps).then(() => undefined);
        }
        return;
      };

      if (!isPromise(valuesRP) && !isPromise(lvaluesRP)) {
        return apply(valuesRP as LuaValue[], lvaluesRP as LuaLValueContainer[]);
      }
      if (isPromise(valuesRP) && !isPromise(lvaluesRP)) {
        return (valuesRP as Promise<LuaValue[]>).then((values: LuaValue[]) =>
          apply(values, lvaluesRP as LuaLValueContainer[]),
        );
      }
      if (!isPromise(valuesRP) && isPromise(lvaluesRP)) {
        return (lvaluesRP as Promise<any[]>).then((lvalues: any[]) =>
          apply(valuesRP as LuaValue[], lvalues),
        );
      }
      return (valuesRP as Promise<LuaValue[]>).then((values: LuaValue[]) =>
        (lvaluesRP as Promise<any[]>).then((lvalues: any[]) =>
          apply(values, lvalues),
        ),
      );
    }
    case "Local": {
      const l = asLocal(s);

      const hasInit = Array.isArray(l.expressions) && l.expressions.length > 0;

      for (const att of l.names) {
        const isConst = att.attributes?.includes(LuaAttribute.Const) === true;
        if (isConst && !hasInit) {
          throw new LuaRuntimeError(
            `const variable '${att.name}' must be initialized`,
            sf.withCtx(att.ctx),
          );
        }
      }

      const bindOne = (name: any, v: LuaValue) => {
        const isConst = name.attributes?.includes(LuaAttribute.Const) === true;
        const isClose = name.attributes?.includes(LuaAttribute.Close) === true;

        if (isConst || isClose) {
          env.setLocalConst(name.name, v);
        } else {
          env.setLocal(name.name, v);
        }

        if (isClose) {
          luaMarkToBeClosed(sf, v, name.ctx);
        }
      };

      if (!hasInit) {
        for (let i = 0; i < l.names.length; i++) {
          bindOne(l.names[i], null);
        }
        return;
      }

      // Evaluate initializers left-to-right and bind/mark `<close>`
      // locals as soon as they receive a value.  This ensures earlier
      // `<close>` locals are closed if a later initializer errors.
      const exprs = l.expressions!;
      const out: LuaValue[] = [];
      let boundCount = 0;

      const bindAvailable = () => {
        while (boundCount < l.names.length && boundCount < out.length) {
          bindOne(l.names[boundCount], out[boundCount] ?? null);
          boundCount++;
        }
      };

      const finish = () => {
        while (out.length < l.names.length) {
          out.push(null);
        }
        bindAvailable();
      };

      const runFrom = (i: number): void | Promise<void> => {
        if (i >= exprs.length) {
          finish();
          return;
        }

        const isLastExpr = i === exprs.length - 1;
        const rp = evalExpression(exprs[i], env, sf);

        const onValue = (v: LuaValue) => {
          if (isLastExpr) {
            if (v instanceof LuaMultiRes) {
              const flat = v.flatten();
              for (let k = 0; k < flat.values.length; k++) {
                out.push(flat.values[k]);
              }
            } else {
              out.push(v);
            }
          } else {
            out.push(singleResult(v));
          }

          bindAvailable();

          // If we already have enough values for all locals, remaining
          // expressions will not affect the binding, so we can stop.
          if (out.length >= l.names.length && !isLastExpr) {
            return;
          }

          return runFrom(i + 1);
        };

        return rpThen(rp, onValue) as any;
      };

      return runFrom(0) as undefined | Promise<undefined>;
    }
    case "Semicolon": {
      return;
    }
    case "Label": {
      const _lab = asLabel(s); // No-op!
      return;
    }
    case "Goto": {
      const g = asGoto(s);
      return { ctrl: "goto", target: g.name };
    }
    case "Block": {
      const b = asBlock(s);

      if (!b.hasCloseHere) {
        return evalBlockNoClose(b, env, sf, returnOnReturn);
      }

      // Blocks establish a boundary (mark) and close all entries
      // created within the block on exit or error, shrinking the stack
      // back to mark.  This is _required_ for correct `pcall` and
      // `xpcall` boundary semantics.
      const closeStack = luaEnsureCloseStack(sf);
      const mark = closeStack.length;

      let out: EvalBlockResult;
      try {
        out = evalBlockNoClose(b, env, sf, returnOnReturn);
      } catch (e: any) {
        const errObj: LuaValue =
          e instanceof LuaRuntimeError ? e.message : (e?.message ?? String(e));
        const r = luaCloseFromMark(sf, mark, errObj);
        if (isPromise(r)) {
          return (r as Promise<void>).then(() => {
            throw e;
          });
        }
        throw e;
      }

      return withCloseBoundary(sf, mark, out);
    }
    case "If": {
      const iff = asIf(s);
      // Evaluate conditions in order; avoid awaiting when not necessary
      const conds = iff.conditions;

      const runFrom = (
        i: number,
      ): undefined | ControlSignal | Promise<undefined | ControlSignal> => {
        if (i >= conds.length) {
          if (iff.elseBlock) {
            return evalStatement(iff.elseBlock, env, sf, returnOnReturn);
          }
          return;
        }
        const cv = evalExpression(conds[i].condition, env, sf);
        if (isPromise(cv)) {
          return (cv as Promise<any>).then((val) => {
            if (luaTruthy(val)) {
              return evalStatement(conds[i].block, env, sf, returnOnReturn);
            }
            return runFrom(i + 1);
          });
        }
        if (luaTruthy(cv)) {
          return evalStatement(conds[i].block, env, sf, returnOnReturn);
        }
        return runFrom(i + 1);
      };

      return runFrom(0);
    }
    case "While": {
      const w = asWhile(s);

      // Sync-first loop that re-enters sync mode after each async iteration
      const runSyncFirst = ():
        | undefined
        | ControlSignal
        | Promise<undefined | ControlSignal> => {
        while (true) {
          const c = evalExpression(w.condition, env, sf);
          if (isPromise(c)) {
            return (c as Promise<any>).then((cv) => {
              if (!luaTruthy(cv)) return;
              return rpThen(
                evalStatement(w.block, env, sf, returnOnReturn),
                (res) => {
                  if (res !== undefined) {
                    return isBreakSignal(res) ? undefined : res;
                  }
                  return runSyncFirst();
                },
              );
            });
          }
          if (!luaTruthy(c)) break;
          const r = evalStatement(w.block, env, sf, returnOnReturn);
          if (isPromise(r)) {
            return (r as Promise<any>).then((res) => {
              if (res !== undefined) {
                return isBreakSignal(res) ? undefined : res;
              }
              return runSyncFirst();
            });
          }
          if (r !== undefined) {
            if (isBreakSignal(r)) break;
            return r;
          }
        }
        return;
      };

      return runSyncFirst();
    }
    case "Repeat": {
      const rep = asRepeat(s);

      // Sync-first loop that re-enters sync mode after each async iteration
      const runSyncFirst = ():
        | undefined
        | ControlSignal
        | Promise<undefined | ControlSignal> => {
        while (true) {
          const rr = evalStatement(rep.block, env, sf, returnOnReturn);
          if (isPromise(rr)) {
            return (rr as Promise<any>).then((res) => {
              if (res !== undefined) {
                return isBreakSignal(res) ? undefined : res;
              }
              return rpThen(evalExpression(rep.condition, env, sf), (cv) =>
                luaTruthy(cv) ? undefined : runSyncFirst(),
              );
            });
          }
          if (rr !== undefined) {
            if (isBreakSignal(rr)) return;
            return rr;
          }

          const c = evalExpression(rep.condition, env, sf);
          if (isPromise(c)) {
            return (c as Promise<any>).then((cv) =>
              luaTruthy(cv) ? undefined : runSyncFirst(),
            );
          }
          if (luaTruthy(c)) break;
        }
        return;
      };

      return runSyncFirst();
    }
    case "Break": {
      return { ctrl: "break" };
    }
    case "FunctionCallStatement": {
      const fcs = asFunctionCallStmt(s);
      const r = evalExpression(fcs.call, env, sf);
      if (isPromise(r)) {
        return (r as Promise<any>).then(() => undefined);
      }
      return;
    }
    case "Function": {
      const fn = asFunctionStmt(s);
      let body = fn.body;
      let propNames = fn.name.propNames;
      if (fn.name.colonName) {
        // function hello:there() -> function hello.there(self) transformation
        body = {
          ...fn.body,
          parameters: ["self", ...fn.body.parameters],
        };
        propNames = [...fn.name.propNames, fn.name.colonName];
      }
      let settable: ILuaGettable = env;
      for (let i = 0; i < propNames.length - 1; i++) {
        settable = (settable as any).get(propNames[i]);
        if (!settable) {
          throw new LuaRuntimeError(
            `Cannot find property ${propNames[i]}`,
            sf.withCtx(fn.name.ctx),
          );
        }
      }
      (settable as any).set(
        propNames[propNames.length - 1],
        new LuaFunction(body, env),
      );
      return;
    }
    case "LocalFunction": {
      const lf = asLocalFunction(s);
      env.setLocal(lf.name, new LuaFunction(lf.body, env));
      return;
    }
    case "Return": {
      const ret = asReturn(s);

      const parts = ret.expressions.map((value: LuaExpression) =>
        evalExpression(value, env, sf),
      );
      const valuesRP = rpAll(parts);

      const finalize = (vals: any[]): ReturnSignal => {
        const outVals: LuaValue[] = [];

        if (vals.length === 0) {
          return { ctrl: "return", values: outVals };
        }

        for (let i = 0; i < vals.length; i++) {
          const isLast = i === vals.length - 1;
          const v = vals[i];

          if (!isLast) {
            outVals.push(singleResult(v));
            continue;
          }

          if (v instanceof LuaMultiRes) {
            const flat = v.flatten();
            outVals.push(...flat.values);
          } else {
            outVals.push(v);
          }
        }

        return {
          ctrl: "return" as const,
          values: outVals,
        };
      };

      if (isPromise(valuesRP)) {
        return (valuesRP as Promise<any[]>).then((vals) => finalize(vals));
      }
      return finalize(valuesRP as any[]);
    }
    case "For": {
      const fr = asFor(s);
      const startV = evalExpression(fr.start, env, sf);
      const endV = evalExpression(fr.end, env, sf);
      const stepV = fr.step ? evalExpression(fr.step, env, sf) : 1;

      const determineLoopType = (): NumericType => {
        const startType = astNumberKind(fr.start);
        const stepType = fr.step ? astNumberKind(fr.step) : "int";
        return startType === "float" || stepType === "float" ? "float" : "int";
      };

      const wrapLoopVar = (i: number, loopType: NumericType) => {
        if (loopType === "float") {
          return makeLuaFloat(i);
        }
        return i;
      };

      const canReuseEnv =
        !fr.block.hasFunctionDef || fr.capturesLoopVar === false;

      const executeIteration = canReuseEnv
        ? (
            loopEnv: LuaEnv,
            i: number,
            loopType: NumericType,
          ): undefined | ControlSignal | Promise<undefined | ControlSignal> => {
            loopEnv.setLocal(fr.name, wrapLoopVar(i, loopType));
            return evalStatement(fr.block, loopEnv, sf, returnOnReturn);
          }
        : (
            _loopEnv: LuaEnv,
            i: number,
            loopType: NumericType,
          ): undefined | ControlSignal | Promise<undefined | ControlSignal> => {
            const localEnv = new LuaEnv(env);
            localEnv.setLocal(fr.name, wrapLoopVar(i, loopType));
            return evalStatement(fr.block, localEnv, sf, returnOnReturn);
          };

      // Continuation that re-enters sync mode after each async iteration
      const runFromIndex = (
        loopEnv: LuaEnv,
        end: number,
        step: number,
        startIndex: number,
        loopType: NumericType,
      ): undefined | ControlSignal | Promise<undefined | ControlSignal> => {
        if (step === 0) {
          throw new LuaRuntimeError("'for' step is zero", sf.withCtx(fr.ctx));
        }

        const shouldContinue =
          step > 0 ? (i: number) => i <= end : (i: number) => i >= end;

        for (let i = startIndex; shouldContinue(i); i += step) {
          const r = executeIteration(loopEnv, i, loopType);
          if (isPromise(r)) {
            return (r as Promise<any>).then((res) => {
              if (res !== undefined) {
                return isBreakSignal(res) ? undefined : res;
              }
              return runFromIndex(loopEnv, end, step, i + step, loopType);
            });
          }
          if (r !== undefined) {
            if (isBreakSignal(r)) return;
            return r;
          }
        }
        return;
      };

      const runSyncFirst = (
        start: number,
        end: number,
        step: number,
        loopType: NumericType,
      ): undefined | ControlSignal | Promise<undefined | ControlSignal> => {
        if (step === 0) {
          throw new LuaRuntimeError("'for' step is zero", sf.withCtx(fr.ctx));
        }

        const shouldContinue =
          step > 0 ? (i: number) => i <= end : (i: number) => i >= end;

        const loopEnv = new LuaEnv(env);

        for (let i = start; shouldContinue(i); i += step) {
          const r = executeIteration(loopEnv, i, loopType);
          if (isPromise(r)) {
            return (r as Promise<any>).then((res) => {
              if (res !== undefined) {
                if (isBreakSignal(res)) {
                  return;
                }
                return res;
              }
              return runFromIndex(loopEnv, end, step, i + step, loopType);
            });
          }
          if (r !== undefined) {
            if (isBreakSignal(r)) {
              return;
            }
            return r;
          }
        }
        return;
      };

      const loopType = determineLoopType();

      if (!isPromise(startV) && !isPromise(endV) && !isPromise(stepV)) {
        return runSyncFirst(
          untagNumber(startV) as number,
          untagNumber(endV) as number,
          untagNumber(stepV ?? 1) as number,
          loopType,
        );
      }
      return Promise.all([
        isPromise(startV) ? startV : Promise.resolve(startV),
        isPromise(endV) ? endV : Promise.resolve(endV),
        isPromise(stepV) ? stepV : Promise.resolve(stepV),
      ]).then(([start, end, step]) => {
        return runSyncFirst(
          untagNumber(start) as number,
          untagNumber(end) as number,
          untagNumber(step ?? 1) as number,
          loopType,
        );
      });
    }
    case "ForIn": {
      const fi = asForIn(s);
      const exprVals = rpAll(
        fi.expressions.map((e: LuaExpression) => evalExpression(e, env, sf)),
      );

      const canReuseEnv =
        !fi.block.hasFunctionDef || fi.capturesLoopVar === false;
      const setIterVars = (
        localEnv: LuaEnv,
        names: string[],
        values: LuaValue[],
      ) => {
        for (let i = 0; i < names.length; i++) {
          localEnv.setLocal(names[i], values[i]);
        }
      };

      const afterExprs = (resolved: any[]) => {
        const iteratorMultiRes = new LuaMultiRes(resolved).flatten();
        let iteratorValue: ILuaFunction | any = iteratorMultiRes.values[0];
        // Handle the case where the iterator is a table and we need
        // to call the `each` function.
        if (Array.isArray(iteratorValue) || iteratorValue instanceof LuaTable) {
          iteratorValue = (env.get("each") as ILuaFunction).call(
            sf,
            iteratorValue,
          );
        }

        if (!iteratorValue?.call) {
          console.error("Cannot iterate over", iteratorMultiRes.values[0]);
          throw new LuaRuntimeError(
            `Cannot iterate over ${iteratorMultiRes.values[0]}`,
            sf.withCtx(fi.ctx),
          );
        }

        const state: LuaValue = iteratorMultiRes.values[1] ?? null;
        let control: LuaValue = iteratorMultiRes.values[2] ?? null;
        const closing: LuaValue = iteratorMultiRes.values[3] ?? null;

        const closeStack = luaEnsureCloseStack(sf);
        const mark = closeStack.length;

        if (closing !== null) {
          luaMarkToBeClosed(sf, closing, fi.ctx);
        }

        const errObjFrom = (e: any): LuaValue =>
          e instanceof LuaRuntimeError ? e.message : (e?.message ?? String(e));

        const finish = (res: any) => {
          const r = luaCloseFromMark(sf, mark, null);
          return isPromise(r) ? (r as Promise<void>).then(() => res) : res;
        };

        const finishErr = (e: any): Promise<never> | never => {
          const errObj = errObjFrom(e);
          const r = luaCloseFromMark(sf, mark, errObj);
          if (isPromise(r)) {
            return (r as Promise<void>).then(() => {
              throw e;
            });
          }
          throw e;
        };

        // Allocate the reusable env once before the loop
        const loopEnv = canReuseEnv ? new LuaEnv(env) : null;

        const makeIterEnv = (): LuaEnv => {
          if (loopEnv) {
            return loopEnv;
          }
          return new LuaEnv(env);
        };

        // Sync-first loop that re-enters sync mode after each async iteration
        const runSyncFirst = (): any => {
          while (true) {
            const iterCall = luaCall(
              iteratorValue,
              [state, control],
              fi.ctx,
              sf,
            );

            const afterIterCall = (itv: any): any => {
              const iterResult = new LuaMultiRes(itv).flatten();
              const nextControl = iterResult.values[0];
              if (nextControl === null || nextControl === undefined) {
                return finish(undefined);
              }
              control = nextControl;

              const localEnv = makeIterEnv();
              setIterVars(localEnv, fi.names, iterResult.values);

              const r = evalStatement(fi.block, localEnv, sf, returnOnReturn);
              return rpThen(r, (res) => {
                if (res !== undefined) {
                  if (isBreakSignal(res)) {
                    return finish(undefined);
                  }
                  return rpThen(finish(undefined), () => res);
                }
                return runSyncFirst();
              });
            };

            if (isPromise(iterCall)) {
              return (iterCall as Promise<any>)
                .then(afterIterCall)
                .catch((e: any) => finishErr(e));
            }

            const iterResult = new LuaMultiRes(iterCall).flatten();
            const nextControl = iterResult.values[0];
            if (nextControl === null || nextControl === undefined) {
              return finish(undefined);
            }
            control = nextControl;

            const localEnv = makeIterEnv();
            setIterVars(localEnv, fi.names, iterResult.values);

            const r = evalStatement(fi.block, localEnv, sf, returnOnReturn);
            if (isPromise(r)) {
              return (r as Promise<any>)
                .then((res) => {
                  if (res !== undefined) {
                    if (isBreakSignal(res)) {
                      return finish(undefined);
                    }
                    return rpThen(finish(undefined), () => res);
                  }
                  return runSyncFirst();
                })
                .catch((e: any) => finishErr(e));
            }
            if (r !== undefined) {
              if (isBreakSignal(r)) {
                return finish(undefined);
              }
              return rpThen(finish(undefined), () => r);
            }
          }
        };

        try {
          return runSyncFirst();
        } catch (e: any) {
          return finishErr(e);
        }
      };

      if (isPromise(exprVals)) {
        return (exprVals as Promise<any[]>).then(afterExprs);
      }
      return afterExprs(exprVals as any[]);
    }
  }
}

function evalLValue(
  lval: LuaLValue,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaLValueContainer | Promise<LuaLValueContainer> {
  switch (lval.type) {
    case "Variable": {
      const v = asLValueVariable(lval);
      return {
        env,
        key: v.name,
      };
    }
    case "TableAccess": {
      const ta = asLValueTableAccess(lval);
      const objValue = evalExpression(ta.object, env, sf);
      const keyValue = evalExpression(ta.key, env, sf);
      if (isPromise(objValue) || isPromise(keyValue)) {
        return Promise.all([
          isPromise(objValue) ? objValue : Promise.resolve(objValue),
          isPromise(keyValue) ? keyValue : Promise.resolve(keyValue),
        ]).then(([objValue, keyValue]) => ({
          env: singleResult(objValue),
          key: singleResult(keyValue),
        }));
      }
      return {
        env: singleResult(objValue),
        key: singleResult(keyValue),
      };
    }
    case "PropertyAccess": {
      const pa = asLValuePropertyAccess(lval);
      const objValue = evalExpression(pa.object, env, sf);
      if (isPromise(objValue)) {
        return (objValue as Promise<any>).then((ov) => {
          return {
            env: ov,
            key: pa.property,
          };
        });
      }
      return {
        env: objValue,
        key: pa.property,
      };
    }
  }
}
